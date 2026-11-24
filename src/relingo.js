var config = require('./config.js');

const relingoUrl = "https://api.relingo.net";
const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function makeError(type, message, extra) {
    const err = new Error(message);
    Object.assign(err, {
        _type: type || "unknown",
        _message: message || "未知错误"
    }, extra || {});
    return err;
}

async function requestRelingo(endpoint, body, options) {
    const opts = options || {};
    const userConfig = config.getConfig();
    const token = opts.token !== undefined ? opts.token : userConfig.token;
    const headers = {
        "Content-Type": "application/json",
        "x-relingo-app": "website",
        "x-relingo-lang": userConfig.lang || "cn",
        "User-Agent": DEFAULT_UA
    };
    if (token) {
        headers["x-relingo-token"] = token;
    }

    const req = {
        method: "POST",
        url: relingoUrl + endpoint,
        header: headers,
        body: body || {},
        timeout: opts.timeout || 20
    };
    if (opts.cancelSignal) {
        req.cancelSignal = opts.cancelSignal;
    }

    let resp;
    try {
        resp = await $http.request(req);
    } catch (e) {
        $log.error("Relingo 网络请求异常 [" + endpoint + "] ==> " + JSON.stringify(e));
        throw makeError("network", "网络请求失败: " + (e.message || JSON.stringify(e)), { _canFallback: true });
    }

    if (resp && resp.error) {
        $log.error("Relingo HTTP 错误 [" + endpoint + "] ==> " + JSON.stringify(resp.error));
        throw makeError("network", resp.error.message || resp.error.localizedDescription || "网络请求失败", { _canFallback: true });
    }

    const statusCode = resp && resp.response ? resp.response.statusCode : 0;
    const data = resp ? resp.data : null;

    if (statusCode === 403) {
        throw makeError(
            "api",
            "Relingo 请求被拒绝 (403)：可能是 Credits 积分不足、所选引擎受限或账号权限不足",
            { _canFallback: true, _statusCode: 403 }
        );
    }
    if (statusCode === 401) {
        throw makeError(
            "secretKey",
            "Relingo 登录已失效 (401)，请在插件设置中重新验证",
            { _canFallback: true, _statusCode: 401 }
        );
    }
    if (statusCode >= 400) {
        const msg = data && data.message ? String(data.message) : ("HTTP " + statusCode);
        throw makeError("api", endpoint + " 请求失败 (" + statusCode + "): " + msg, { _canFallback: true, _statusCode: statusCode });
    }

    if (!data || typeof data !== "object") {
        throw makeError("api", endpoint + " 返回格式异常，请检查网络", { _canFallback: true });
    }

    if (data.code === 2001) {
        if (!opts.skipTokenReset) {
            const latest = config.getConfig();
            latest.token = "";
            latest.status = "init";
            config.updateConfig(latest);
        }
        throw makeError(
            "secretKey",
            "Relingo 登录已过期或未登录 (2001)，请在插件设置中重新验证",
            { _canFallback: true, _apiCode: 2001 }
        );
    }

    if (data.code !== 0) {
        const errMsg = data.message ? String(data.message) : (endpoint + " 请求失败 (code=" + data.code + ")");
        throw makeError("api", errMsg, { _apiCode: data.code, _canFallback: data.code === 403 });
    }

    return data;
}

// 发送邮箱验证码
async function authorization(email) {
    const targetEmail = (email || $option.email || "").trim();
    await requestRelingo("/api/authorization", { email: targetEmail }, { token: "", skipTokenReset: true });
    const userConfig = config.getConfig();
    userConfig.status = "waitingCode";
    userConfig.mailCodeSendAt = Date.now();
    userConfig.mail = targetEmail;
    config.updateConfig(userConfig);
}

// 邮箱验证码登录
async function loginByCode(email, code) {
    const targetEmail = (email || $option.email || "").trim();
    const targetCode = (code || $option.mailCode || "").trim();
    try {
        const resp = await requestRelingo(
            "/api/loginByCode",
            { email: targetEmail, code: targetCode },
            { token: "", skipTokenReset: true }
        );
        const payload = resp.data || {};
        if (!payload.token) {
            throw makeError("api", "登录成功但未返回 Token");
        }
        const userConfig = config.getConfig();
        userConfig.status = "active";
        userConfig.username = payload.name || "";
        userConfig.mail = targetEmail;
        userConfig.mailCode = targetCode;
        userConfig.token = payload.token;
        userConfig.tokenUpdatedAt = Date.now();
        userConfig.tokenExpireAt = payload.expiredAt || 0;
        config.updateConfig(userConfig);
        return payload;
    } catch (e) {
        // 验证码过期或错误时重置为 init，避免卡死在 waitingCode（对应 issue #6）
        const userConfig = config.getConfig();
        if (userConfig.status === "waitingCode") {
            userConfig.status = "init";
            config.updateConfig(userConfig);
        }
        throw e;
    }
}

// 邮箱密码登录
async function loginByPassword(email, password) {
    const targetEmail = (email || $option.email || "").trim();
    const targetPassword = password !== undefined ? password : ($option.password || "");
    const resp = await requestRelingo(
        "/api/login",
        { email: targetEmail, password: targetPassword },
        { token: "", skipTokenReset: true }
    );
    const payload = resp.data || {};
    if (!payload.token) {
        throw makeError("api", "密码登录未返回 Token，请检查账号或改用验证码/Token 登录");
    }
    const userConfig = config.getConfig();
    userConfig.status = "active";
    userConfig.username = payload.name || "";
    userConfig.mail = targetEmail;
    userConfig.token = payload.token;
    userConfig.tokenUpdatedAt = Date.now();
    userConfig.tokenExpireAt = payload.expiredAt || 0;
    config.updateConfig(userConfig);
    return payload;
}

// 查询用户信息 / 刷新 Token
async function getUserInfo(overrideToken) {
    const resp = await requestRelingo("/api/getUserInfo", {}, { token: overrideToken });
    const payload = resp.data || {};
    const userConfig = config.getConfig();
    userConfig.status = "active";
    if (payload.token) {
        userConfig.token = payload.token;
    } else if (overrideToken) {
        userConfig.token = overrideToken;
    }
    if (payload.name) {
        userConfig.username = payload.name;
    }
    if (payload.email) {
        userConfig.mail = payload.email;
    }
    userConfig.tokenUpdatedAt = Date.now();
    config.updateConfig(userConfig);
    return payload;
}

// 获取用户词本配置（兼容 langBooks 与旧版 books）
async function getUserConfig(overrideToken) {
    const resp = await requestRelingo("/api/getUserConfig", {}, { token: overrideToken });
    const userConfig = config.getConfig();
    const cfg = (resp.data && resp.data.config) || {};

    let rawBooks = [];
    if (cfg.langBooks && typeof cfg.langBooks === "object") {
        if (Array.isArray(cfg.langBooks.en) && cfg.langBooks.en.length > 0) {
            rawBooks = cfg.langBooks.en;
        } else {
            const keys = Object.keys(cfg.langBooks);
            for (let i = 0; i < keys.length; i++) {
                const list = cfg.langBooks[keys[i]];
                if (Array.isArray(list) && list.length > 0) {
                    rawBooks = rawBooks.concat(list);
                }
            }
        }
    }
    if (rawBooks.length === 0 && Array.isArray(cfg.books)) {
        rawBooks = cfg.books;
    }

    const books = [];
    let strangeId = "default";
    let masteredId = "mastered";

    for (let i = 0; i < rawBooks.length; i++) {
        const book = rawBooks[i];
        if (!book) continue;
        const bookId = book._id || book.id;
        if (book.name === "strange") {
            if (bookId) {
                strangeId = bookId;
                books.push(bookId);
            }
            continue;
        }
        if (book.name === "mastered") {
            if (bookId) {
                masteredId = bookId;
            }
            continue;
        }
        if (book.active && bookId) {
            books.push(bookId);
        }
    }

    userConfig.strange = strangeId;
    userConfig.mastered = masteredId;
    userConfig.books = books;
    if (cfg.lang && cfg.lang.native) {
        userConfig.native = cfg.lang.native;
    }
    config.updateConfig(userConfig);
    return cfg;
}

// Token 直连登录
async function loginByToken(token) {
    const cleanToken = (token || "").trim();
    if (!cleanToken) {
        throw makeError("secretKey", "Relingo Token 不能为空");
    }
    await getUserInfo(cleanToken);
    await getUserConfig(cleanToken);
}

// 从个人词本查询单词
async function parseContent3(to, word, withDefinition, cancelSignal) {
    const userConfig = config.getConfig();
    const resp = await requestRelingo(
        "/api/parseContent3",
        {
            to: to,
            words: [word],
            vocabulary: userConfig.books || [],
            definition: !!withDefinition
        },
        { cancelSignal: cancelSignal }
    );
    const words = resp.data && resp.data.words;
    if (!Array.isArray(words) || words.length === 0) {
        throw makeError("notFound", "此单词未在 Relingo 个人词本中收录");
    }
    return words[0];
}

// 从全词本查询单词（支持登录态与免登录）
async function lookupDict2(to, word, withDefinition, cancelSignal) {
    const resp = await requestRelingo(
        "/api/lookupDict2",
        {
            to: to,
            words: [word],
            definition: !!withDefinition
        },
        { cancelSignal: cancelSignal }
    );
    const list = resp.data;
    if (!Array.isArray(list) || list.length === 0) {
        throw makeError("notFound", "此单词未在 Relingo 词库中收录");
    }
    return list[0];
}

// 修改单词状态（对齐新版 relingo.net：统一使用 submitVocabulary）
async function submitVocabulary(word, type) {
    const userConfig = config.getConfig();
    const targetType = type === "strange" ? "strange" : "mastered";
    const targetId = targetType === "mastered"
        ? (userConfig.mastered || "mastered")
        : (userConfig.strange || "default");

    await requestRelingo("/api/submitVocabulary", {
        id: targetId,
        type: targetType,
        words: [word]
    });
}

// 兼容旧导出名：标记为生词/忘记了
async function removeVocabularyWords(word) {
    return submitVocabulary(word, "strange");
}

// Relingo 段落翻译
async function translateParagraph(text, to, providerId, cancelSignal) {
    const resp = await requestRelingo(
        "/api/translateParagraph",
        {
            text: text,
            to: to,
            providerId: providerId || "google"
        },
        { cancelSignal: cancelSignal }
    );
    const data = resp.data;
    if (typeof data === "string") {
        return data;
    }
    if (data && typeof data.text === "string") {
        return data.text;
    }
    throw makeError("api", "Relingo 翻译接口未返回有效文本", { _canFallback: true });
}

exports.authorization = authorization;
exports.loginByCode = loginByCode;
exports.loginByPassword = loginByPassword;
exports.loginByToken = loginByToken;
exports.getUserInfo = getUserInfo;
exports.getUserConfig = getUserConfig;
exports.parseContent3 = parseContent3;
exports.lookupDict2 = lookupDict2;
exports.removeVocabularyWords = removeVocabularyWords;
exports.submitVocabulary = submitVocabulary;
exports.translateParagraph = translateParagraph;
