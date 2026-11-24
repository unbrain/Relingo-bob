var config = require('./config.js');
var relingo = require('./relingo.js');
var words = require('./word.js');
var utils = require('./utils.js');
var fallback = require('./fallback.js');

var items = [
    ["auto", "auto"],
    ["zh-Hans", "zh"],
    ["zh-Hant", "zh"],
    ["en", "en"],
    ["ja", "ja"],
    ["ko", "ko"],
    ["fr", "fr"],
    ["es", "es"],
    ["pt", "pt"],
    ["hi", "hi"],
    ["ru", "ru"],
    ["ar", "ar"],
    ["de", "de"]
];
var langMap = new Map(items);

function supportLanguages() {
    return items.map(([standardLang]) => standardLang);
}

function isSingleEnglishWord(text, sourceLanguage) {
    if (sourceLanguage !== "en" && sourceLanguage !== "auto") {
        return false;
    }
    const trimmed = (text || "").trim();
    if (!trimmed || trimmed.length > 64) {
        return false;
    }
    // 支持普通英文单词及连字符复合词（如 state-of-the-art）
    return /^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/.test(trimmed);
}

function getAuthSignature() {
    const method = $option.loginMethod || "code";
    const email = ($option.email || "").trim();
    const token = ($option.token || "").trim();
    if (method === "token") {
        return "token:" + token.slice(0, 16);
    }
    if (method === "guest") {
        return "guest";
    }
    return method + ":" + email;
}

function translate(query, completion) {
    const reply = typeof query.onCompletion === "function" ? query.onCompletion : completion;

    (async () => {
        if (await utils.cipCc(query, reply)) {
            return;
        }

        const userConfig = config.getConfig();
        if (userConfig.token) {
            try {
                await utils.updateTokenConfig(userConfig);
            } catch (e) {
                $log.error("自动刷新 Relingo Token 失败: " + JSON.stringify(e));
                // 若配置了兜底引擎或全词本模式，不阻断后续查词/兜底翻译
                if ($option.wordModel === "0" && ($option.fallbackEngine || "mymemory") === "none") {
                    throw e;
                }
            }
        }

        if (await utils.checkVocabulary(query, reply)) {
            return;
        }

        const sourceLanguage = langMap.get(query.detectFrom);
        const targetLanguage = langMap.get(query.detectTo);
        if (!targetLanguage) {
            const err = new Error("不支持该语种");
            Object.assign(err, {
                _type: "unsupportedLanguage",
                _message: "不支持该语种"
            });
            throw err;
        }

        const sourceLang = sourceLanguage || "en";
        const targetLang = targetLanguage || userConfig.native || "zh";
        const translateText = (query.text || "").trim();
        if (!translateText) {
            return;
        }

        // 1. 英文单词查询（全词本支持免登录，个人词本需登录）
        if (isSingleEnglishWord(translateText, sourceLang)) {
            const wordModel = $option.wordModel || "1";
            const latestConfig = config.getConfig();
            if (wordModel === "1" || latestConfig.token) {
                try {
                    await words.translate(query, sourceLang, targetLang, reply);
                    return;
                } catch (e) {
                    if (e._type !== "notFound") {
                        throw e;
                    }
                }
            }
        }

        // 2. 句子 / 段落翻译
        const engine = $option.translationEngine || "google";
        const fallbackEngine = $option.fallbackEngine || "mymemory";

        if (engine === "mymemory" || engine === "custom-llm") {
            await fallback.translateWithEngine(engine, query, reply);
            return;
        }

        const latestConfig = config.getConfig();
        if (!latestConfig.token) {
            if (fallbackEngine !== "none") {
                await fallback.translateWithEngine(fallbackEngine, query, reply);
                return;
            }
            const err = new Error("未登录 Relingo");
            Object.assign(err, {
                _type: "secretKey",
                _message: "Relingo 句子翻译需要先登录，或在设置中将翻译引擎/兜底引擎设为 MyMemory 或自定义 LLM"
            });
            throw err;
        }

        try {
            const translated = await relingo.translateParagraph(
                query.text,
                targetLang,
                engine,
                query.cancelSignal
            );
            reply({
                result: utils.buildTextResult(query.detectFrom, query.detectTo, translated)
            });
        } catch (e) {
            if (e._canFallback && fallbackEngine !== "none") {
                $log.info("Relingo 翻译失败，切换兜底引擎 [" + fallbackEngine + "]: " + (e._message || ""));
                await fallback.translateWithEngine(fallbackEngine, query, reply);
                return;
            }
            throw e;
        }
    })().catch((err) => {
        reply({
            error: {
                type: err._type || "unknown",
                message: err._message || ("未知错误: " + (err.message || JSON.stringify(err)))
            }
        });
    });
}

function pluginValidate(completion) {
    (async () => {
        const loginMethod = $option.loginMethod || "code";
        const email = ($option.email || "").trim();
        const mailCode = ($option.mailCode || "").trim();
        const password = $option.password || "";
        const token = ($option.token || "").trim();

        if (loginMethod === "guest") {
            config.resetAuthConfig("guest");
            const cfg = config.getConfig();
            cfg.status = "guest";
            config.updateConfig(cfg);
            await relingo.lookupDict2("zh", "hello", false);
            completion({ result: true });
            return;
        }

        if (loginMethod === "token") {
            if (!token) {
                completion({
                    result: false,
                    error: {
                        type: "secretKey",
                        message: "请填写 Relingo Token（x-relingo-token）"
                    }
                });
                return;
            }
            const sig = getAuthSignature();
            const cfg = config.getConfig();
            if (cfg.authSignature !== sig) {
                config.resetAuthConfig(sig);
            }
            await relingo.loginByToken(token);
            completion({ result: true });
            return;
        }

        if (!email) {
            completion({
                result: false,
                error: {
                    type: "secretKey",
                    message: "邮箱不能为空"
                }
            });
            return;
        }

        if (loginMethod === "password") {
            if (!password) {
                completion({
                    result: false,
                    error: {
                        type: "secretKey",
                        message: "请填写 Relingo 登录密码"
                    }
                });
                return;
            }
            const sig = getAuthSignature();
            config.resetAuthConfig(sig);
            await relingo.loginByPassword(email, password);
            await relingo.getUserInfo();
            await relingo.getUserConfig();
            completion({ result: true });
            return;
        }

        // 默认：邮箱验证码登录
        const sig = getAuthSignature();
        let userConfig = config.getConfig();
        if (userConfig.authSignature !== sig || userConfig.mail !== email) {
            userConfig = config.resetAuthConfig(sig);
        }

        switch (userConfig.status) {
            case "init":
            case "guest":
            case "error":
                await relingo.authorization(email);
                completion({
                    result: false,
                    error: {
                        type: "secretKey",
                        message: "邮箱验证码已发送，请将验证码填入「邮箱验证码」后再次点击验证"
                    }
                });
                return;
            case "waitingCode":
                if (!mailCode) {
                    completion({
                        result: false,
                        error: {
                            type: "secretKey",
                            message: "请填入邮箱收到的验证码后再次点击验证"
                        }
                    });
                    return;
                }
                await relingo.loginByCode(email, mailCode);
                await relingo.getUserInfo();
                await relingo.getUserConfig();
                break;
            case "active":
                if (mailCode && mailCode !== userConfig.mailCode) {
                    await relingo.loginByCode(email, mailCode);
                }
                await relingo.getUserInfo();
                await relingo.getUserConfig();
                break;
            default:
                await relingo.authorization(email);
                completion({
                    result: false,
                    error: {
                        type: "secretKey",
                        message: "邮箱验证码已发送，请将验证码填入「邮箱验证码」后再次点击验证"
                    }
                });
                return;
        }

        completion({ result: true });
    })().catch((err) => {
        completion({
            result: false,
            error: {
                type: err._type || "unknown",
                message: err._message || ("未知错误: " + (err.message || JSON.stringify(err)))
            }
        });
    });
}

function pluginTimeoutInterval() {
    return 60;
}
