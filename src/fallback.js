var utils = require('./utils.js');

const mymemoryLangMap = new Map([
    ["zh-Hans", "zh-CN"],
    ["zh-Hant", "zh-TW"],
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
]);

const langNameMap = new Map([
    ["zh-Hans", "Simplified Chinese"],
    ["zh-Hant", "Traditional Chinese"],
    ["en", "English"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["fr", "French"],
    ["es", "Spanish"],
    ["pt", "Portuguese"],
    ["hi", "Hindi"],
    ["ru", "Russian"],
    ["ar", "Arabic"],
    ["de", "German"]
]);

function makeError(type, message) {
    const err = new Error(message);
    Object.assign(err, {
        _type: type || "unknown",
        _message: message || "未知错误"
    });
    return err;
}

function splitLongLine(line, maxLen) {
    const parts = [];
    let rest = line;
    while (rest.length > maxLen) {
        let cut = -1;
        const slice = rest.slice(0, maxLen);
        const punctMatches = slice.match(/.*[。！？.!?;；\s]/);
        if (punctMatches && punctMatches[0].length >= Math.floor(maxLen * 0.4)) {
            cut = punctMatches[0].length;
        } else {
            cut = maxLen;
        }
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest) {
        parts.push(rest);
    }
    return parts;
}

function splitTextChunks(text, maxLen) {
    const lines = String(text || "").split("\n");
    const chunks = [];
    let current = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = "";
            }
            const subParts = splitLongLine(line, maxLen);
            for (let j = 0; j < subParts.length; j++) {
                chunks.push(subParts[j]);
            }
            continue;
        }
        const candidate = current ? (current + "\n" + line) : line;
        if (candidate.length > maxLen) {
            chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current || chunks.length === 0) {
        chunks.push(current);
    }
    return chunks;
}

async function translateByMyMemory(query, reply) {
    const fromCode = mymemoryLangMap.get(query.detectFrom) || "en";
    const toCode = mymemoryLangMap.get(query.detectTo);
    if (!toCode) {
        throw makeError("unsupportedLanguage", "MyMemory 兜底引擎不支持该目标语种");
    }
    if (fromCode === toCode) {
        reply({
            result: utils.buildTextResult(query.detectFrom, query.detectTo, query.text || "")
        });
        return;
    }

    const chunks = splitTextChunks(query.text || "", 400);
    const translatedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk.trim()) {
            translatedChunks.push(chunk);
            continue;
        }
        const url = "https://api.mymemory.translated.net/get?q="
            + encodeURIComponent(chunk)
            + "&langpair="
            + encodeURIComponent(fromCode + "|" + toCode);

        const req = {
            method: "GET",
            url: url,
            timeout: 20
        };
        if (query.cancelSignal) {
            req.cancelSignal = query.cancelSignal;
        }

        const resp = await $http.request(req);
        if (resp && resp.error) {
            throw makeError("network", resp.error.message || "MyMemory 请求失败");
        }
        const data = resp ? resp.data : null;
        if (!data || Number(data.responseStatus) !== 200 || !data.responseData || typeof data.responseData.translatedText !== "string") {
            const detail = data && data.responseDetails ? String(data.responseDetails) : "MyMemory 翻译失败";
            throw makeError("api", detail);
        }
        translatedChunks.push(data.responseData.translatedText);
    }

    reply({
        result: utils.buildTextResult(query.detectFrom, query.detectTo, translatedChunks.join("\n"))
    });
}

function normalizeChatCompletionsUrl(rawUrl) {
    const trimmed = (rawUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) {
        return "";
    }
    if (/\/chat\/completions$/i.test(trimmed)) {
        return trimmed;
    }
    if (/\/(v\d+[a-z]*|openai)$/i.test(trimmed)) {
        return trimmed + "/chat/completions";
    }
    return trimmed + "/v1/chat/completions";
}

async function translateByCustomLlm(query, reply) {
    const endpoint = normalizeChatCompletionsUrl($option.customLlmUrl);
    const apiKey = ($option.customLlmKey || "").trim();
    const model = ($option.customLlmModel || "").trim() || "gpt-4o-mini";

    if (!endpoint) {
        throw makeError("param", "请先在插件设置中填写「自定义 LLM 地址」");
    }
    if (!apiKey) {
        throw makeError("secretKey", "请先在插件设置中填写「自定义 LLM Key」");
    }

    const targetName = langNameMap.get(query.detectTo) || query.detectTo || "Simplified Chinese";
    const req = {
        method: "POST",
        url: endpoint,
        header: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey
        },
        body: {
            model: model,
            temperature: 0.2,
            messages: [
                {
                    role: "system",
                    content: "You are a professional translator. Translate the user's text accurately and naturally into " + targetName + ". Preserve line breaks and formatting. Output only the translated text without explanations."
                },
                {
                    role: "user",
                    content: query.text || ""
                }
            ]
        },
        timeout: 45
    };
    if (query.cancelSignal) {
        req.cancelSignal = query.cancelSignal;
    }

    const resp = await $http.request(req);
    if (resp && resp.error) {
        throw makeError("network", resp.error.message || "自定义 LLM 请求失败");
    }
    const statusCode = resp && resp.response ? resp.response.statusCode : 0;
    const data = resp ? resp.data : null;
    if (statusCode >= 400) {
        const msg = data && data.error && data.error.message ? data.error.message : ("HTTP " + statusCode);
        throw makeError("api", "自定义 LLM 请求失败: " + msg);
    }
    const rawContent = data && Array.isArray(data.choices) && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";
    const content = String(rawContent || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (!content) {
        throw makeError("api", "自定义 LLM 未返回有效译文");
    }
    reply({
        result: utils.buildTextResult(query.detectFrom, query.detectTo, content)
    });
}

async function translateWithEngine(engine, query, reply) {
    if (engine === "mymemory") {
        return translateByMyMemory(query, reply);
    }
    if (engine === "custom-llm") {
        return translateByCustomLlm(query, reply);
    }
    throw makeError("param", "未知兜底引擎: " + engine);
}

exports.translateByMyMemory = translateByMyMemory;
exports.translateByCustomLlm = translateByCustomLlm;
exports.translateWithEngine = translateWithEngine;
