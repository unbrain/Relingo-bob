var relingo = require('./relingo.js');
var config = require('./config.js');
var locales = require('./locales.js');

const POS_MAP = {
    NOUN: "n.",
    VERB: "v.",
    ADJ: "adj.",
    ADJECTIVE: "adj.",
    ADV: "adv.",
    ADVERB: "adv.",
    PREP: "prep.",
    PREPOSITION: "prep.",
    CONJ: "conj.",
    CONJUNCTION: "conj.",
    PRON: "pron.",
    PRONOUN: "pron.",
    INTJ: "int.",
    INTERJECTION: "int.",
    DET: "det.",
    DETERMINER: "det.",
    NUM: "num.",
    AUX: "aux.",
    PHRASE: "phr.",
    X: ""
};

function formatPos(rawPos) {
    const upper = String(rawPos || "").trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(POS_MAP, upper)) {
        return POS_MAP[upper];
    }
    return String(rawPos || "").trim().toLowerCase();
}

function formatEnglishDefinitions(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
        return "";
    }
    const lines = [];
    const maxGroups = Math.min(definitions.length, 3);
    for (let i = 0; i < maxGroups; i++) {
        const group = definitions[i];
        if (!group) continue;
        const pos = group.partOfSpeech || group.pos || "";
        if (pos) {
            lines.push("[" + pos + "]");
        }
        const items = Array.isArray(group.definitions) ? group.definitions : [];
        const maxItems = Math.min(items.length, 3);
        for (let j = 0; j < maxItems; j++) {
            const item = items[j];
            if (!item || !item.definition) continue;
            lines.push((j + 1) + ". " + String(item.definition).trim());
            if (Array.isArray(item.examples) && item.examples.length > 0) {
                lines.push("   e.g. " + String(item.examples[0]).trim());
            }
        }
        if (Array.isArray(group.synonyms) && group.synonyms.length > 0) {
            lines.push("近义词: " + group.synonyms.slice(0, 6).join(", "));
        }
        if (Array.isArray(group.antonyms) && group.antonyms.length > 0) {
            lines.push("反义词: " + group.antonyms.slice(0, 6).join(", "));
        }
    }
    const joined = lines.join("\n");
    if (joined.length > 1200) {
        return joined.slice(0, 1197) + "...";
    }
    return joined;
}

// 单词翻译
async function translate(query, lookupWord, source_lang, target_lang, reply, isGuestMode) {
    const wordModel = $option.wordModel || "1";
    const additionalDisplay = $option.additionalDisplay || "2";
    const withDefinition = additionalDisplay === "2";
    const userConfig = config.getConfig();
    const cleanWord = (lookupWord || query.text || "").trim();
    const hasToken = !isGuestMode && !!userConfig.token;

    let data;
    if (wordModel === "1") {
        data = await relingo.lookupDict2(target_lang, cleanWord, withDefinition, query.cancelSignal);
    } else {
        if (!hasToken) {
            const err = new Error("个人词本查询需要先登录 Relingo");
            Object.assign(err, {
                _type: "secretKey",
                _message: "个人词本查询需要先在插件设置中登录 Relingo（或切换为全词本查询）"
            });
            throw err;
        }
        data = await relingo.parseContent3(target_lang, cleanWord, withDefinition, query.cancelSignal);
    }

    if (!data) {
        const err = new Error("未查询到单词数据");
        Object.assign(err, {
            _type: "notFound",
            _message: "此单词未在 Relingo 词库中收录"
        });
        throw err;
    }

    const displayWord = data.word || cleanWord;
    const toDict = {
        word: displayWord,
        phonetics: [],
        parts: [],
        exchanges: [],
        additions: []
    };

    if (data.phonetic && Array.isArray(data.phonetic.us) && data.phonetic.us[0]) {
        toDict.phonetics.push({
            type: "us",
            value: data.phonetic.us[0],
            tts: {
                type: "url",
                value: "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(displayWord) + "&type=2"
            }
        });
    }
    if (data.phonetic && Array.isArray(data.phonetic.uk) && data.phonetic.uk[0]) {
        toDict.phonetics.push({
            type: "uk",
            value: data.phonetic.uk[0],
            tts: {
                type: "url",
                value: "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(displayWord) + "&type=1"
            }
        });
    }

    if (Array.isArray(data.translations)) {
        const posMap = {};
        data.translations.forEach((item) => {
            if (!item || !item.target) return;
            const pos = formatPos(item.pos);
            const target = item.target;
            if (posMap[pos]) {
                if (posMap[pos].means.indexOf(target) === -1) {
                    posMap[pos].means.push(target);
                }
            } else {
                const newObj = { part: pos, means: [target] };
                toDict.parts.push(newObj);
                posMap[pos] = newObj;
            }
        });
    }

    if ($option.variant === "1" && data.variant && typeof data.variant === "object") {
        for (const key in data.variant) {
            if (Object.prototype.hasOwnProperty.call(data.variant, key)) {
                const tags = Array.isArray(data.variant[key]) ? data.variant[key] : [];
                const names = tags.map((item) => locales.getlocales(item, target_lang));
                toDict.exchanges.push({
                    name: names.join(", ") || "变体",
                    words: [key]
                });
            }
        }
    }

    const enDefText = withDefinition ? formatEnglishDefinitions(data.definition) : "";

    // 若既无中文释义也无英英释义（如部分专有名词空词条），回落到句子翻译
    if (toDict.parts.length === 0 && !enDefText) {
        const err = new Error("未查询到有效释义");
        Object.assign(err, {
            _type: "notFound",
            _message: "此单词未在 Relingo 词库中收录有效释义"
        });
        throw err;
    }

    if (additionalDisplay !== "0") {
        const extraInfo = [];
        if (hasToken) {
            extraInfo.push("掌握情况: " + (data.mastered ? "✅ 已掌握" : "❌ 未掌握"));
        } else {
            extraInfo.push("登录状态: 未登录（仅查词）");
        }
        if (data.wordFrequency) {
            extraInfo.push("词频: " + "🌟".repeat(Math.min(Number(data.wordFrequency) || 0, 5)));
        }
        if (data.lemma && data.lemma !== displayWord) {
            extraInfo.push("词根/原型: " + data.lemma);
        }
        if (extraInfo.length > 0) {
            toDict.additions.push({
                name: "Relingo 信息",
                value: extraInfo.join("\n")
            });
        }

        if (withDefinition) {
            if (enDefText) {
                toDict.additions.push({
                    name: "英英释义",
                    value: enDefText
                });
            }
            if (data.etymology) {
                toDict.additions.push({
                    name: "词源",
                    value: data.etymology
                });
            }
        }
    }

    if (hasToken) {
        userConfig.lastWords = displayWord;
        config.updateConfig(userConfig);
        if (data.mastered) {
            toDict.exchanges.push({ name: "修改状态", words: ["忘记了"] });
        } else {
            toDict.exchanges.push({ name: "修改状态", words: ["已掌握", "加入生词本"] });
        }
    }

    reply({
        result: {
            from: query.detectFrom,
            to: query.detectTo,
            toDict: toDict
        }
    });
}

exports.translate = translate;
