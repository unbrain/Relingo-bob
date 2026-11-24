const configPath = "$sandbox/config.json";

const defaultConfig = {
    version: "0.0.2",
    authSignature: "",
    username: "",
    mail: "",
    mailCode: "",
    mailCodeSendAt: 0,
    token: "",
    tokenUpdatedAt: 0,
    tokenExpireAt: 0,
    status: "init", // init | waitingCode | active | guest | error
    lang: "cn",
    native: "zh",
    strange: "default",
    mastered: "mastered",
    books: [],
    lastWords: ""
};

function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(defaultConfig));
}

function updateConfig(config) {
    if (config && typeof config === "object") {
        const safeConfig = Object.assign(cloneDefaultConfig(), config);
        safeConfig.version = defaultConfig.version;
        // 敏感密码绝不落盘
        delete safeConfig.password;
        $file.write({
            data: $data.fromUTF8(JSON.stringify(safeConfig)),
            path: configPath
        });
        return safeConfig;
    }
    const err = new Error();
    Object.assign(err, {
        _type: "param",
        _message: "config异常，更新失败: " + JSON.stringify(config)
    });
    throw err;
}

function configInit() {
    if ($file.exists(configPath) && !$file.isDirectory(configPath)) {
        return;
    }
    if ($file.exists(configPath) && $file.isDirectory(configPath)) {
        $file.delete(configPath);
    }
    $file.write({
        data: $data.fromUTF8(JSON.stringify(cloneDefaultConfig())),
        path: configPath
    });
}

function getConfig() {
    configInit();
    try {
        const raw = $file.read(configPath).toUTF8();
        const parsed = JSON.parse(raw);
        const merged = Object.assign(cloneDefaultConfig(), parsed || {});
        if (!Array.isArray(merged.books)) {
            merged.books = [];
        }
        if (parsed.version !== defaultConfig.version) {
            merged.version = defaultConfig.version;
            updateConfig(merged);
        }
        return merged;
    } catch (e) {
        $log.error("读取 config.json 失败，重置默认配置: " + JSON.stringify(e));
        const fresh = cloneDefaultConfig();
        updateConfig(fresh);
        return fresh;
    }
}

function resetAuthConfig(authSignature) {
    const current = getConfig();
    current.authSignature = authSignature || "";
    current.username = "";
    current.mail = "";
    current.mailCode = "";
    current.mailCodeSendAt = 0;
    current.token = "";
    current.tokenUpdatedAt = 0;
    current.tokenExpireAt = 0;
    current.status = "init";
    current.strange = "default";
    current.mastered = "mastered";
    current.books = [];
    return updateConfig(current);
}

exports.configPath = configPath;
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
exports.resetAuthConfig = resetAuthConfig;
