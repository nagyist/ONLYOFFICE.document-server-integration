﻿"use strict";
/**
 *
 * (c) Copyright Ascensio System SIA 2021
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

const express = require("express");
const path = require("path");
const favicon = require("serve-favicon");
const bodyParser = require("body-parser");
const fileSystem = require("fs");
const formidable = require("formidable");
const syncRequest = require("sync-request");
const jwt = require('jsonwebtoken');
const config = require('config');
const configServer = config.get('server');
const storageFolder = configServer.get("storageFolder");
const mime = require("mime");
const docManager = require("./helpers/docManager");
const documentService = require("./helpers/documentService");
const fileUtility = require("./helpers/fileUtility");
const siteUrl = configServer.get('siteUrl');
const fileChoiceUrl = configServer.has('fileChoiceUrl') ? configServer.get('fileChoiceUrl') : "";
const plugins = config.get('plugins');
const cfgSignatureEnable = configServer.get('token.enable');
const cfgSignatureUseForRequest = configServer.get('token.useforrequest');
const cfgSignatureAuthorizationHeader = configServer.get('token.authorizationHeader');
const cfgSignatureAuthorizationHeaderPrefix = configServer.get('token.authorizationHeaderPrefix');
const cfgSignatureSecretExpiresIn = configServer.get('token.expiresIn');
const cfgSignatureSecret = configServer.get('token.secret');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


String.prototype.hashCode = function () {
	const len = this.length;
	let ret = 0;
    for (let i = 0; i < len; i++) {
        ret = (31 * ret + this.charCodeAt(i)) << 0;
    }
    return ret;
};
String.prototype.format = function () {
    let text = this.toString();

    if (!arguments.length) return text;

    for (let i = 0; i < arguments.length; i++) {
        text = text.replace(new RegExp("\\{" + i + "\\}", "gi"), arguments[i]);
    }

    return text;
};


const app = express();
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");


app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

app.use(express.static(path.join(__dirname, "public")));
if (config.has('server.static')) {
  const staticContent = config.get('server.static');
  for (let i = 0; i < staticContent.length; ++i) {
    const staticContentElem = staticContent[i];
    app.use(staticContentElem['name'], express.static(staticContentElem['path'], staticContentElem['options']));
  }
}
app.use(favicon(__dirname + "/public/images/favicon.ico"));


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));


app.get("/", function (req, res) {
    try {

        docManager.init(storageFolder, req, res);

        res.render("index", {
            preloaderUrl: siteUrl + configServer.get('preloaderUrl'),
            convertExts: configServer.get('convertedDocs').join(","),
            editedExts: configServer.get('editedDocs').join(","),
            storedFiles: docManager.getStoredFiles(),
            params: docManager.getCustomParams()
        });

    }
    catch (ex) {
        console.log(ex);
        res.status(500);
        res.render("error", { message: "Server error" });
        return;
    }
});

app.get("/download", function(req, res) {
    docManager.init(storageFolder, req, res);

    var fileName = fileUtility.getFileName(req.query.fileName);
    var userAddress = req.query.useraddress;

    if (cfgSignatureEnable && cfgSignatureUseForRequest) { 
        var authorization = req.get(cfgSignatureAuthorizationHeader);
        if (authorization && authorization.startsWith(cfgSignatureAuthorizationHeaderPrefix)) {
            var token = authorization.substring(cfgSignatureAuthorizationHeaderPrefix.length);
            try {
                var decoded = jwt.verify(token, cfgSignatureSecret);
            } catch (err) {
                console.log('checkJwtHeader error: name = ' + err.name + ' message = ' + err.message + ' token = ' + token)
                res.sendStatus(403);
                return;
            }
        }
    }

    var path = docManager.forcesavePath(fileName, userAddress, false);
    if (path == "") {
        path = docManager.storagePath(fileName, userAddress);
    }

    res.setHeader("Content-Length", fileSystem.statSync(path).size);
    res.setHeader("Content-Type", mime.getType(path));

    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8\'\'" + encodeURIComponent(fileName));

    var filestream = fileSystem.createReadStream(path);
    filestream.pipe(res);
});

app.post("/upload", function (req, res) {

    docManager.init(storageFolder, req, res);
    docManager.storagePath(""); //mkdir if not exist

    const userIp = docManager.curUserHostAddress();
    const uploadDir = path.join(storageFolder, userIp);
    const uploadDirTmp = path.join(uploadDir, 'tmp');
    docManager.createDirectory(uploadDirTmp);

    const form = new formidable.IncomingForm();
    form.uploadDir = uploadDirTmp;
    form.keepExtensions = true;
    form.maxFileSize = configServer.get("maxFileSize");

    form.parse(req, function (err, fields, files) {
    	if (err) {
			docManager.cleanFolderRecursive(uploadDirTmp, true);
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.write("{ \"error\": \"" + err.message + "\"}");
			res.end();
			return;
		}

        const file = files.uploadedFile;

        if (file == undefined) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.write("{ \"error\": \"Uploaded file not found\"}");
            res.end();
            return;
        }

        file.name = docManager.getCorrectName(file.name);

        if (configServer.get('maxFileSize') < file.size || file.size <= 0) {
			docManager.cleanFolderRecursive(uploadDirTmp, true);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.write("{ \"error\": \"File size is incorrect\"}");
            res.end();
            return;
        }

        const exts = [].concat(configServer.get('viewedDocs'), configServer.get('editedDocs'), configServer.get('convertedDocs'));
        const curExt = fileUtility.getFileExtension(file.name);
        const documentType = fileUtility.getFileType(file.name);

        if (exts.indexOf(curExt) == -1) {
			docManager.cleanFolderRecursive(uploadDirTmp, true);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.write("{ \"error\": \"File type is not supported\"}");
            res.end();
            return;
        }

        fileSystem.rename(file.path, uploadDir + "/" + file.name, function (err) {
			docManager.cleanFolderRecursive(uploadDirTmp, true);
            res.writeHead(200, { "Content-Type": "text/plain" });
            if (err) {
                res.write("{ \"error\": \"" + err + "\"}");
            } else {
                res.write("{ \"filename\": \"" + file.name + "\", \"documentType\": \"" + documentType + "\" }");

                const userid = req.query.userid ? req.query.userid : "uid-1";
                const name = req.query.name ? req.query.name : "John Smith";

                docManager.saveFileData(file.name, userid, name);
            }
            res.end();
        });
    });
});

app.post("/convert", function (req, res) {

    var fileName = fileUtility.getFileName(req.body.filename);
    var filePass = req.body.filePass ? req.body.filePass : null;
    var fileUri = docManager.getFileUri(fileName);
    var fileExt = fileUtility.getFileExtension(fileName);
    var fileType = fileUtility.getFileType(fileName);
    var internalFileExt = docManager.getInternalExtension(fileType);
    var response = res;

    var writeResult = function (filename, step, error) {
        var result = {};

        if (filename != null)
            result["filename"] = filename;

        if (step != null)
            result["step"] = step;

        if (error != null)
            result["error"] = error;

        response.setHeader("Content-Type", "application/json");
        response.write(JSON.stringify(result));
        response.end();
    };

    var callback = function (err, data) {
        if (err) {
            if (err.name === "ConnectionTimeoutError" || err.name === "ResponseTimeoutError") {
                writeResult(fileName, 0, null);
            } else {
                writeResult(null, null, JSON.stringify(err));
            }
            return;
        }

        try {
            var responseUri = documentService.getResponseUri(data.toString());
            var result = responseUri.key;
            var newFileUri = responseUri.value;

            if (result != 100) {
                writeResult(fileName, result, null);
                return;
            }

            var correctName = docManager.getCorrectName(fileUtility.getFileName(fileName, true) + internalFileExt);

            var file = syncRequest("GET", newFileUri);
            fileSystem.writeFileSync(docManager.storagePath(correctName), file.getBody());

            fileSystem.unlinkSync(docManager.storagePath(fileName));

            var userAddress = docManager.curUserHostAddress();
            var historyPath = docManager.historyPath(fileName, userAddress, true);
            var correctHistoryPath = docManager.historyPath(correctName, userAddress, true);

            fileSystem.renameSync(historyPath, correctHistoryPath);

            fileSystem.renameSync(path.join(correctHistoryPath, fileName + ".txt"), path.join(correctHistoryPath, correctName + ".txt"));

            writeResult(correctName, result, null);
        } catch (e) {
            console.log(e);
            writeResult(null, null, e.message);
        }
    };

    try {
        if (configServer.get('convertedDocs').indexOf(fileExt) != -1) {
            let storagePath = docManager.storagePath(fileName);
            const stat = fileSystem.statSync(storagePath);
            let key = fileUri + stat.mtime.getTime();

            key = documentService.generateRevisionId(key);
            documentService.getConvertedUri(fileUri, fileExt, internalFileExt, key, true, callback, filePass);
        } else {
            writeResult(fileName, null, null);
        }
    } catch (ex) {
        console.log(ex);
        writeResult(null, null, "Server error");
    }
});

app.get("/files", function(req, res) {
    try {
        docManager.init(storageFolder, req, res); 
        const filesInDirectoryInfo = docManager.getFilesInfo();
        res.setHeader("Content-Type", "application/json");
        res.write(JSON.stringify(filesInDirectoryInfo));
    } catch (ex) {
        console.log(ex);
        res.write("Server error");
    }
    res.end();
});

app.get("/files/file/:fileId", function(req, res) {
    try {
        docManager.init(storageFolder, req, res);
        const fileId = req.params.fileId;
        const fileInfoById = docManager.getFilesInfo(fileId);
        res.setHeader("Content-Type", "application/json");
        res.write(JSON.stringify(fileInfoById));
    } catch (ex) {
        console.log(ex);
        res.write("Server error");
    }
    res.end();
});

app.delete("/file", function (req, res) {
    try {
    	docManager.init(storageFolder, req, res);
        let fileName = req.query.filename;
        if (fileName) {
			fileName = fileUtility.getFileName(fileName);

			const filePath = docManager.storagePath(fileName);
			fileSystem.unlinkSync(filePath);

			const userAddress = docManager.curUserHostAddress();
			const historyPath = docManager.historyPath(fileName, userAddress, true);
			docManager.cleanFolderRecursive(historyPath, true);
		} else {
			docManager.cleanFolderRecursive(docManager.storagePath(''), false);
		}

        res.write("{\"success\":true}");
    } catch (ex) {
        console.log(ex);
        res.write("Server error");
    }
    res.end();
});

app.get("/csv", function (req, res) {
    var fileName = "csv.csv";
    var csvPath = path.join(__dirname, "public", "assets",  "sample", fileName);

    res.setHeader("Content-Length", fileSystem.statSync(csvPath).size);
    res.setHeader("Content-Type", mime.getType(csvPath));

    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8\'\'" + encodeURIComponent(fileName));

    var filestream = fileSystem.createReadStream(csvPath);
    filestream.pipe(res);
})

app.post("/track", function (req, res) {

    docManager.init(storageFolder, req, res);

    var userAddress = req.query.useraddress;
    var fileName = fileUtility.getFileName(req.query.filename);
    var version = 0;

    var processTrack = function (response, body, fileName, userAddress) {

        var callbackProcessSave = function (downloadUri, body, fileName, userAddress, newFileName) {
            try {
                var storagePath = docManager.storagePath(newFileName, userAddress);

                var historyPath = docManager.historyPath(newFileName, userAddress);
                if (historyPath == "") {
                    historyPath = docManager.historyPath(newFileName, userAddress, true);
                    docManager.createDirectory(historyPath);
                }

                var count_version = docManager.countVersion(historyPath);
                version = count_version + 1;
                var versionPath = docManager.versionPath(newFileName, userAddress, version);
                docManager.createDirectory(versionPath);

                var downloadZip = body.changesurl;
                if (downloadZip) {
                    var path_changes = docManager.diffPath(newFileName, userAddress, version);
                    var diffZip = syncRequest("GET", downloadZip);
                    fileSystem.writeFileSync(path_changes, diffZip.getBody());
                }

                var changeshistory = body.changeshistory || JSON.stringify(body.history);
                if (changeshistory) {
                    var path_changes_json = docManager.changesPath(newFileName, userAddress, version);
                    fileSystem.writeFileSync(path_changes_json, changeshistory);
                }

                var path_key = docManager.keyPath(newFileName, userAddress, version);
                fileSystem.writeFileSync(path_key, body.key);

                var path_prev = path.join(versionPath, "prev" + fileUtility.getFileExtension(fileName));
                fileSystem.renameSync(docManager.storagePath(fileName, userAddress), path_prev);

                var file = syncRequest("GET", downloadUri);
                fileSystem.writeFileSync(storagePath, file.getBody());

                var forcesavePath = docManager.forcesavePath(newFileName, userAddress, false);
                if (forcesavePath != "") {
                    fileSystem.unlinkSync(forcesavePath);
                }

            } catch (ex) {
                response.write("{\"error\":1}");
                response.end();
                return;
            }

            response.write("{\"error\":0}");
            response.end();
        }

        var processSave = function (downloadUri, body, fileName, userAddress, resp) {
            var curExt = fileUtility.getFileExtension(fileName);
            var downloadExt = fileUtility.getFileExtension(downloadUri);
            var newFileName = fileName;

            if (downloadExt != curExt) {
                var key = documentService.generateRevisionId(downloadUri);
                newFileName = docManager.getCorrectName(fileUtility.getFileName(fileName, true) + downloadExt, userAddress);
                try {
                    documentService.getConvertedUriSync(downloadUri, downloadExt, curExt, key, function (err, data) {
                        if (err) {
                            callbackProcessSave(downloadUri, body, fileName, userAddress, newFileName);
                            return;
                        }
                        try {
                            var res = documentService.getResponseUri(data);
                            callbackProcessSave(res.value, body, fileName, userAddress, fileName);
                            return;
                        } catch (ex) {
                            console.log(ex);
                            callbackProcessSave(downloadUri, body, fileName, userAddress, newFileName);
                            return;
                        }
                    });
                    return;
                } catch (ex) {
                    console.log(ex);
                }
            }
            callbackProcessSave(downloadUri, body, fileName, userAddress, newFileName);
        };

        var callbackProcessForceSave = function (downloadUri, body, fileName, userAddress, newFileName = false){
            try {
                var downloadExt = fileUtility.getFileExtension(downloadUri);
                var isSubmitForm = body.forcesavetype === 3; //SubmitForm

                if (isSubmitForm) {
                    //new file
                    if (newFileName){
                        fileName = docManager.getCorrectName(fileUtility.getFileName(fileName, true) + "-form" + downloadExt, userAddress);
                    } else {
                        var ext = fileUtility.getFileExtension(fileName);
                        fileName = docManager.getCorrectName(fileUtility.getFileName(fileName, true) + "-form" + ext, userAddress);
                    }
                    var forcesavePath = docManager.storagePath(fileName, userAddress);
                } else {
                    if (newFileName){
                        fileName = docManager.getCorrectName(fileUtility.getFileName(fileName, true) + downloadExt, userAddress);
                    }
                    forcesavePath = docManager.forcesavePath(fileName, userAddress, false);
                    if (forcesavePath == "") {
                        forcesavePath = docManager.forcesavePath(fileName, userAddress, true);
                    }
                }

                var file = syncRequest("GET", downloadUri);
                fileSystem.writeFileSync(forcesavePath, file.getBody());

                if (isSubmitForm) {
                    var uid =body.actions[0].userid
                    docManager.saveFileData(fileName, uid, "Filling Form", userAddress);
                }
            } catch (ex) {
                response.write("{\"error\":1}");
                response.end();
                return;
            }

            response.write("{\"error\":0}");
            response.end();
        }

        var processForceSave = function (downloadUri, body, fileName, userAddress, resp) {
            var curExt = fileUtility.getFileExtension(fileName);
            var downloadExt = fileUtility.getFileExtension(downloadUri);

            if (downloadExt != curExt) {
                var key = documentService.generateRevisionId(downloadUri);
                try {
                    documentService.getConvertedUriSync(downloadUri, downloadExt, curExt, key, function (err, data) {
                        if (err) {
                            callbackProcessForceSave(downloadUri, body, fileName, userAddress, true);
                            return;
                        }
                        try {
                            var res = documentService.getResponseUri(data);
                            callbackProcessForceSave(res.value, body, fileName, userAddress, false);
                            return;
                        } catch (ex) {
                            console.log(ex);
                            callbackProcessForceSave(downloadUri, body, fileName, userAddress, true);
                            return;
                        }
                    });
                    return;
                } catch (ex) {
                    console.log(ex);
                }
            }
            callbackProcessForceSave (downloadUri, body, fileName, userAddress, false);
        };

        if (body.status == 1) { //Editing
            if (body.actions && body.actions[0].type == 0) { //finished edit
                var user = body.actions[0].userid;
                if (body.users.indexOf(user) == -1) {
                    var key = body.key;
                    try {
                        documentService.commandRequest("forcesave", key);
                    } catch (ex) {
                        console.log(ex);
                    }
                }
            }

        } else if (body.status == 2 || body.status == 3) { //MustSave, Corrupted
            processSave(body.url, body, fileName, userAddress, response);
            return;
        } else if (body.status == 6 || body.status == 7) { //MustForceSave, CorruptedForceSave
            processForceSave(body.url, body, fileName, userAddress, response);
            return;
        }

        response.write("{\"error\":0}");
        response.end();
    };

    var readbody = function (request, response, fileName, userAddress) {
        var content = "";
        request.on('data', function (data) {
            content += data;
        });
        request.on('end', function () {
            var body = JSON.parse(content);
            processTrack(response, body, fileName, userAddress);
        });
    };

    //checkjwt
    if (cfgSignatureEnable && cfgSignatureUseForRequest) {
        var body = null;
        if (req.body.hasOwnProperty("token")) {
            body = documentService.readToken(req.body.token);
        } else {
            var checkJwtHeaderRes = documentService.checkJwtHeader(req);
            if (checkJwtHeaderRes) {
                var body;
                if (checkJwtHeaderRes.payload) {
                    body = checkJwtHeaderRes.payload;
                }
                if (checkJwtHeaderRes.query) {
                    if (checkJwtHeaderRes.query.useraddress) {
                        userAddress = checkJwtHeaderRes.query.useraddress;
                    }
                    if (checkJwtHeaderRes.query.filename) {
                        fileName = fileUtility.getFileName(checkJwtHeaderRes.query.filename);
                    }
                }
            }
        }
        if (body == null) {
            res.write("{\"error\":1}");
            res.end();
            return;
        }
        processTrack(res, body, fileName, userAddress);
        return;
    }

    if (req.body.hasOwnProperty("status")) {
        processTrack(res, req.body, fileName, userAddress);
    } else {
        readbody(req, res, fileName, userAddress);
    }
});

app.get("/editor", function (req, res) {
    try {

        docManager.init(storageFolder, req, res);

        var fileExt = req.query.fileExt;
        var history = [];
        var historyData = [];
        var lang = docManager.getLang();
        var userid = req.query.userid ? req.query.userid : "uid-1";
        var name = (userid == "uid-0" ? null : (req.query.name ? req.query.name : "John Smith"));
        var actionData = req.query.action ? req.query.action : "null";

        var userGroup = null;
        var reviewGroups = null;
        if (userid == "uid-2")
        {
            userGroup = "group-2";
            // own and without group
            reviewGroups = ["group-2", ""];
        } else if (userid == "uid-3") {
            userGroup = "group-3";
            // other group only
            reviewGroups = ["group-2"];
        }

        if (fileExt != null) {
            var fileName = docManager.createDemo(!!req.query.sample, fileExt, userid, name);

            var redirectPath = docManager.getServerUrl() + "/editor?fileName=" + encodeURIComponent(fileName) + docManager.getCustomParams();
            res.redirect(redirectPath);
            return;
        }

        var userAddress = docManager.curUserHostAddress();
        var fileName = fileUtility.getFileName(req.query.fileName);
        if (!docManager.existsSync(docManager.storagePath(fileName, userAddress))) {
            throw { 
                "message": "File not found: " + fileName
            };
        }
        var key = docManager.getKey(fileName);
        var url = docManager.getDownloadUrl(fileName);
        var urlUser = docManager.getlocalFileUri(fileName, 0, false)
        var mode = req.query.mode || "edit"; //mode: view/edit/review/comment/fillForms/embedded
        var type = req.query.type || ""; //type: embedded/mobile/desktop
        if (type == "") {
                type = new RegExp(configServer.get("mobileRegEx"), "i").test(req.get('User-Agent')) ? "mobile" : "desktop";
            }

        var canEdit = configServer.get('editedDocs').indexOf(fileUtility.getFileExtension(fileName)) != -1;
        var submitForm = canEdit && (mode == "edit" || mode == "fillForms");

        var countVersion = 1;

        var historyPath = docManager.historyPath(fileName, userAddress);
        var changes = null;
        var keyVersion = key;

        if (historyPath != '') {

            countVersion = docManager.countVersion(historyPath) + 1;
            for (var i = 1; i <= countVersion; i++) {
                if (i < countVersion) {
                    var keyPath = docManager.keyPath(fileName, userAddress, i);
                    keyVersion = "" + fileSystem.readFileSync(keyPath);
                } else {
                    keyVersion = key;
                }
                history.push(docManager.getHistory(fileName, changes, keyVersion, i));

                var historyD = {
                    version: i,
                    key: keyVersion,
                    url: i == countVersion ? url : (docManager.getlocalFileUri(fileName, i, true) + "/prev" + fileUtility.getFileExtension(fileName)),
                };

                if (i > 1 && docManager.existsSync(docManager.diffPath(fileName, userAddress, i-1))) {
                    historyD.previous = {
                        key: historyData[i-2].key,
                        url: historyData[i-2].url,
                    };
                    historyD.changesUrl = docManager.getlocalFileUri(fileName, i-1) + "/diff.zip";
                }

                historyData.push(historyD);
                
                if (i < countVersion) {
                    var changesFile = docManager.changesPath(fileName, userAddress, i);
                    changes = docManager.getChanges(changesFile);
                }
            }
        } else {
            history.push(docManager.getHistory(fileName, changes, keyVersion, countVersion));
            historyData.push({
                version: countVersion,
                key: key,
                url: url
            });
        }

        if (cfgSignatureEnable) {
            for (var i = 0; i < historyData.length; i++) {
                historyData[i].token = jwt.sign(historyData[i], cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
            }
        }

        var argss = {
            apiUrl: siteUrl + configServer.get('apiUrl'),
            file: {
                name: fileName,
                ext: fileUtility.getFileExtension(fileName, true),
                uri: url,
                uriUser: urlUser,
                version: countVersion,
                created: new Date().toDateString(),
                favorite: req.query.userid ? req.query.userid === "uid-2" : "null"
            },
            editor: {
                type: type,
                documentType: fileUtility.getFileType(fileName),
                key: key,
                token: "",
                callbackUrl: docManager.getCallback(fileName),
                createUrl: docManager.getCreateUrl(fileUtility.getFileType(fileName), userid, name, type, lang),
                isEdit: canEdit && (mode == "edit" || mode == "view" || mode == "filter" || mode == "blockcontent"),
                review: mode == "edit" || mode == "review",
                comment: mode != "view" && mode != "fillForms" && mode != "embedded" && mode != "blockcontent",
                fillForms: mode != "view" && mode != "comment" && mode != "embedded" && mode != "blockcontent",
                modifyFilter: mode != "filter",
                modifyContentControl: mode != "blockcontent",
                mode: canEdit && mode != "view" ? "edit" : "view",
                canBackToFolder: type != "embedded",
                backUrl: docManager.getServerUrl() + "/",
                curUserHostAddress: docManager.curUserHostAddress(),
                lang: lang,
                userid: userid,
                name: name,
                userGroup: userGroup,
                reviewGroups: JSON.stringify(reviewGroups),
                fileChoiceUrl: fileChoiceUrl,
                submitForm: submitForm,
                plugins: JSON.stringify(plugins),
                actionData: actionData
            },
            history: history,
            historyData: historyData,
            dataInsertImage: {
                fileType: "png",
                url: docManager.getServerUrl(true) + "/images/logo.png"
            },
            dataCompareFile: {
                fileType: "docx",
                url: docManager.getServerUrl(true) + "/assets/sample/sample.docx"
            },
            dataMailMergeRecipients: {
                fileType: "csv",
                url: docManager.getServerUrl(true) + "/csv"
            }
        };

        if (cfgSignatureEnable) {
            app.render('config', argss, function(err, html){
                if (err) {
                    console.log(err);
                } else {
                    argss.editor.token = jwt.sign(JSON.parse("{"+html+"}"), cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
                    argss.dataInsertImage.token = jwt.sign(argss.dataInsertImage, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
                    argss.dataCompareFile.token = jwt.sign(argss.dataCompareFile, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
                    argss.dataMailMergeRecipients.token = jwt.sign(argss.dataMailMergeRecipients, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
                }
                res.render("editor", argss);
              });
        } else {
              res.render("editor", argss);
        }
    }
    catch (ex) {
        console.log(ex);
        res.status(500);
        res.render("error", { message: "Server error" });
    }
});

app.use(function (req, res, next) {
    const err = new Error("Not Found");
    err.status = 404;
    next(err);
});

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render("error", {
        message: err.message
    });
});

module.exports = app;
