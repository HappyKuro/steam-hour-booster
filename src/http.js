'use strict';

const https = require('https');

function createRequest({ url, method = 'GET', headers = {}, body, timeoutMs = 15000 }) {
    return new Promise((resolve, reject) => {
        let requestUrl;

        try {
            requestUrl = new URL(url);
        } catch (error) {
            reject(error);
            return;
        }

        const options = {
            protocol: requestUrl.protocol,
            hostname: requestUrl.hostname,
            port: requestUrl.port || undefined,
            path: `${requestUrl.pathname}${requestUrl.search}`,
            method,
            headers
        };

        const request = https.request(options, (response) => {
            let responseBody = '';

            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                responseBody += chunk;
            });

            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode || 0,
                    headers: response.headers,
                    body: responseBody
                });
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        });

        request.on('error', reject);

        if (body) {
            request.write(body);
        }

        request.end();
    });
}

module.exports = { createRequest };
