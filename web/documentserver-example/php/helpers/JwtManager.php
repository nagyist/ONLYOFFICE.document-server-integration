<?php

namespace OnlineEditorsExamplePhp\Helpers;

/**
 * (c) Copyright Ascensio System SIA 2023
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
 */

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

final class JwtManager
{
    /**
     * Check if a secret key to generate token exists or not.
     *
     * @return bool
     */
    public function isJwtEnabled(): bool
    {
        $configManager = new ConfigManager();
        return !empty($configManager->getConfig("docServJwtSecret"));
    }

    /**
     * Check if a secret key use for request
     *
     * @return bool
     */
    public function tokenUseForRequest(): bool
    {
        $configManager = new ConfigManager();
        return $configManager->getConfig("docServJwtUseForRequest") ?: false;
    }

    /**
     * Encode a payload object into a token using a secret key
     *
     * @param array $payload
     *
     * @return string
     */
    public function jwtEncode($payload)
    {
        $configManager = new ConfigManager();
        return JWT::encode($payload, $configManager->getConfig("docServJwtSecret"), 'HS256');
    }

    /**
     * Decode a token into a payload object using a secret key
     *
     * @param string $token
     *
     * @return string
     */
    public function jwtDecode($token)
    {
        $configManager = new ConfigManager();
        try {
            $payload = JWT::decode(
                $token,
                new Key($configManager->getConfig("docServJwtSecret"), 'HS256')
            );
        } catch (\UnexpectedValueException $e) {
            $payload = "";
        }

        return $payload;
    }
}
