/**
 *
 * (c) Copyright Ascensio System SIA 2025
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

package com.onlyoffice.integration.documentserver.storage;

import java.nio.file.Path;

// specify the file storage path builder functions
public interface FileStoragePathBuilder {
    void configure(String address);  // create a new storage folder
    String getFileName(String url); // get file name from its URL
    String getStorageLocation();  // get the storage directory
    String getFileLocation(String fileName);  // get the directory of the specified file
    String getServerUrl(Boolean forDocumentServer);  // get the server URL
    String getHistoryDir(String fileName);  // get the history directory
    int getFileVersion(String historyPath, Boolean ifIndexPage);  // get the file version
    String getForcesavePath(String fileName, Boolean create);  /* get the path where all the
    forcely saved file versions are saved or create it */
    Path generateFilepath(String directory, String fullFileName);  /* generate the file path
    from file directory and name */
}
