var config = require('./config.js');
var relingo = require('./relingo.js');

function buildTextResult(from, to, text) {
    const normalized = String(text || "");
    const lines = normalized.split("\n");
    return {
        from: from,
        to: to,
        content: {
            format: "lines",
            text: normalized
        },
        toParagraphs: lines
    };
}

async function checkVocabulary(query, reply) {
    const userConfig = config.getConfig();
    const text = (query.text || "").trim();
    if (text !== "" && userConfig.lastWords !== "" && userConfig.token !== "") {
        if (text === "已掌握") {
            const lastWords = userConfig.lastWords;
            await relingo.submitVocabulary(lastWords, "mastered");
            userConfig.lastWords = "";
            config.updateConfig(userConfig);
            reply({
                result: buildTextResult(query.detectFrom, query.detectTo, lastWords + " 已标记为「已掌握」")
            });
            return true;
        }
        if (text === "忘记了" || text === "加入生词本") {
            const lastWords = userConfig.lastWords;
            await relingo.submitVocabulary(lastWords, "strange");
            userConfig.lastWords = "";
            config.updateConfig(userConfig);
            reply({
                result: buildTextResult(query.detectFrom, query.detectTo, lastWords + " 已添加到 Relingo 生词本")
            });
            return true;
        }
    }
    return false;
}

// 每 24 小时自动刷新一次 Token 与词本配置
async function updateTokenConfig(userConfig) {
    if (!userConfig || !userConfig.token) {
        return;
    }
    const now = Date.now();
    if (now - (userConfig.tokenUpdatedAt || 0) > 86400000) {
        await relingo.getUserInfo();
        await relingo.getUserConfig();
    }
}

// cip.cc IP 归属地查询
async function cipCc(query, reply) {
    try {
        const raw = (query.text || "").trim();
        if (raw.length === 0 || raw.length > 15) {
            return false;
        }
        const text = raw.replaceAll(" ", ".");
        if (/^((25[0-5]|2[0-4]\d|((1\d{2})|([1-9]?\d)))\.){3}(25[0-5]|2[0-4]\d|((1\d{2})|([1-9]?\d)))$/.test(text)) {
            const resp = await $http.request({
                method: "GET",
                url: "https://cip.cc/" + text,
                header: {
                    "User-Agent": "curl/8.1.2"
                },
                cancelSignal: query.cancelSignal
            });
            if (resp && resp.data) {
                const out = typeof resp.data === "string"
                    ? resp.data.trim()
                    : JSON.stringify(resp.data).replaceAll('"', "").replaceAll("\\n", "\n").replaceAll("\\t", "\t").trim();
                reply({
                    result: buildTextResult(query.detectFrom, query.detectTo, out)
                });
                return true;
            }
            return false;
        }
        return false;
    } catch (e) {
        $log.info("cip.cc 查询失败，跳过: " + JSON.stringify(e));
        return false;
    }
}

exports.buildTextResult = buildTextResult;
exports.checkVocabulary = checkVocabulary;
exports.updateTokenConfig = updateTokenConfig;
exports.cipCc = cipCc;
