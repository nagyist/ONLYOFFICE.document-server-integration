﻿/**
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

if (typeof jQuery != "undefined") {
    jq = jQuery.noConflict();

    jq(function () {
        jq('#fileupload').fileupload({
            dataType: 'json',
            add: function (e, data) {
                jq(".error").removeClass("error");
                jq(".done").removeClass("done");
                jq(".current").removeClass("current");
                jq("#step1").addClass("current");
                jq("#mainProgress .error-message").hide().find("span").text("");
                jq("#mainProgress").removeClass("embedded");
                jq("#uploadFileName").text("");

                jq.blockUI({
                    theme: true,
                    title: "File upload" + "<div class=\"dialog-close\"></div>",
                    message: jq("#mainProgress"),
                    overlayCSS: { "background-color": "#aaa" },
                    themedCSS: { width: "539px", top: "20%", left: "50%", marginLeft: "-269px" }
                });
                jq("#beginEdit, #beginView, #beginEmbedded").addClass("disable");

                data.submit();
            },
            always: function (e, data) {
                if (!jq("#mainProgress").is(":visible")) {
                    return;
                }
                var response = data.result;
                if (response.error) {
                    jq(".current").removeClass("current");
                    jq(".step:not(.done)").addClass("error");
                    jq("#mainProgress .error-message").show().find("span").text(response.error);
                    jq('#hiddenFileName').val("");
                    return;
                }

                jq("#hiddenFileName").val(response.filename);
                jq("#uploadFileName").text(response.filename);
                jq("#uploadFileName").addClass(response.documentType);

                jq("#step1").addClass("done").removeClass("current");
                jq("#step2").addClass("current");

                checkConvert();
            }
        });

        initSelectors();
    });
    
    var timer = null;
    var checkConvert = function () {
        if (timer != null) {
            clearTimeout(timer);
        }

        if (!jq("#mainProgress").is(":visible")) {
            return;
        }

        var fileName = jq("#hiddenFileName").val();
        var posExt = fileName.lastIndexOf('.');
        posExt = 0 <= posExt ? fileName.substring(posExt).trim().toLowerCase() : '';

        if (ConvertExtList.indexOf(posExt) == -1) {
            loadScripts();
            return;
        }

        timer = setTimeout(function () {
            jq.ajax({
                async: true,
                contentType: "text/xml",
                type: "post",
                dataType: "json",
                data: JSON.stringify({ filename: fileName }),
                url: UrlConverter,
                complete: function (data) {
                    var responseText = data.responseText;
                    var response = jq.parseJSON(responseText);
                    if (response.error) {
                        jq(".current").removeClass("current");
                        jq(".step:not(.done)").addClass("error");
                        jq("#mainProgress .error-message").show().find("span").text(response.error);
                        jq('#hiddenFileName').val("");
                        return;
                    }

                    jq("#hiddenFileName").val(response.filename);

                    if (response.step && response.step < 100) {
                        checkConvert();
                    } else {
                        loadScripts();
                    }
                }
            });
        }, 1000);
    };

    var loadScripts = function () {
        if (!jq("#mainProgress").is(":visible")) {
            return;
        }
        jq("#step2").addClass("done").removeClass("current");
        jq("#step3").addClass("current");

        if (jq("#loadScripts").is(":empty")) {
            var urlScripts = jq("#loadScripts").attr("data-docs");
            var frame = '<iframe id="iframeScripts" width=1 height=1 style="position: absolute; visibility: hidden;" ></iframe>';
            jq("#loadScripts").html(frame);
            document.getElementById("iframeScripts").onload = onloadScripts;
            jq("#loadScripts iframe").attr("src", urlScripts);
        } else {
            onloadScripts();
        }
    };

    var onloadScripts = function () {
        if (!jq("#mainProgress").is(":visible")) {
            return;
        }
        jq("#step3").addClass("done").removeClass("current");
        jq("#beginView, #beginEmbedded").removeClass("disable");

        var fileName = jq("#hiddenFileName").val();
        var posExt = fileName.lastIndexOf('.');
        posExt = 0 <= posExt ? fileName.substring(posExt).trim().toLowerCase() : '';

        if (EditedExtList.indexOf(posExt) != -1) {
            jq("#beginEdit").removeClass("disable");
        }
    };

    var initSelectors = function () {
        var userSel = jq("#user");
        var langSel = jq("#language");

        function getCookie(name) {
            let matches = document.cookie.match(new RegExp(
                "(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + "=([^;]*)"
            ));
            return matches ? decodeURIComponent(matches[1]) : null;
        }
        function setCookie(name, value) {
            document.cookie = name + "=" + value + "; expires=" + new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toUTCString(); //week
        }

        var userId = getCookie("uid");
        if (userId) userSel.val(userId);
        var langId = getCookie("ulang");
        if (langId) langSel.val(langId);

        userSel.on("change", function () {
            setCookie("uid", userSel.val());
            setCookie("uname", userSel.find("option:selected").text())
        });
        langSel.on("change", function () {
            setCookie("ulang", langSel.val());
        });
    };

    jq(document).on("click", "#beginEdit:not(.disable)", function () {
        var fileId = encodeURIComponent(jq('#hiddenFileName').val());
        var url = UrlEditor + "?fileName=" + fileId;
        window.open(url, "_blank");
        jq('#hiddenFileName').val("");
        jq.unblockUI();
    });

    jq(document).on("click", "#beginView:not(.disable)", function () {
        var fileId = encodeURIComponent(jq('#hiddenFileName').val());
        var url = UrlEditor + "?editorsMode=view&fileName=" + fileId;
        window.open(url, "_blank");
        jq('#hiddenFileName').val("");
        jq.unblockUI();
    });

    jq(document).on("click", "#beginEmbedded:not(.disable)", function () {
        var fileId = encodeURIComponent(jq('#hiddenFileName').val());
        var url = UrlEditor + "?editorsType=embedded&editorsMode=embedded&fileName=" + fileId;

        jq("#mainProgress").addClass("embedded");
        jq("#beginEmbedded").addClass("disable");

        jq("#embeddedView").attr("src", url);
    });

    jq(document).on("click", "#cancelEdit, .dialog-close", function () {
        jq('#hiddenFileName').val("");
        jq("#embeddedView").attr("src", "");
        jq.unblockUI();
    });

    jq(document).on("click", ".try-editor", function (e) {
        var url = "sample?fileExt=" + e.target.attributes["data-type"].value;
        if (jq("#createSample").is(":checked")) {
            url += "&sample=true";
        }
        var w = window.open(url, "_blank");
        w.onload = function () {
            window.location.reload();
        }
    });

    jq(document).on("click", ".delete-file", function () {
        var requestAddress = "remove?filename="
            + encodeURIComponent(jq(this).attr("data-filename"));

        jq.ajax({
            async: true,
            contentType: "text/xml",
            url: requestAddress,
            complete: function (data) {
                document.location.reload();
            }
        });
    });

    jq(".info").mouseover(function (event) {
        var target = event.target;
        var id = target.dataset.id ? target.dataset.id : target.id;
        var tooltip = target.dataset.tooltip;

        jq("<div class='tooltip'>" + tooltip + "<div class='arrow'></div></div>").appendTo("body");

        var top = jq("#" + id).offset().top + jq("#" + id).outerHeight() / 2 - jq("div.tooltip").outerHeight() / 2;
        var left = jq("#" + id).offset().left + jq("#" + id).outerWidth() + 20;
        jq("div.tooltip").css({"top": top, "left": left});
    }).mouseout(function () {
        jq("div.tooltip").remove();
    });
}