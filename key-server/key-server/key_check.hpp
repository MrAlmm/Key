// key_check.hpp
// وحدة التحقق من مفتاح التفعيل عبر السيرفر
// أضف هذا الملف لمشروعك (Add Existing Item) ولا تعدل ملفاتك الأخرى

#pragma once
#include <string>
#include <curl/curl.h>
#include <windows.h>
#include <iostream>

// غيّر هذا الرابط لرابط السيرفر تبعك بعد ما ترفعه على Render
static const std::string SERVER_URL = "https://YOUR-APP-NAME.onrender.com/check-key";

namespace KeyCheck {

    // يجيب Hardware ID فريد للجهاز (بناءً على رقم السيريال للقرص C)
    inline std::string GetHWID() {
        char volumeName[MAX_PATH + 1] = { 0 };
        DWORD serialNumber = 0;
        GetVolumeInformationA("C:\\", volumeName, sizeof(volumeName),
            &serialNumber, nullptr, nullptr, nullptr, 0);

        char buf[32];
        sprintf_s(buf, "%08X", serialNumber);
        return std::string(buf);
    }

    // callback يستقبل رد السيرفر كنص
    inline size_t WriteCallback(void* contents, size_t size, size_t nmemb, std::string* out) {
        size_t total = size * nmemb;
        out->append((char*)contents, total);
        return total;
    }

    // يرسل المفتاح + الـ HWID للسيرفر، ويرجع true لو التفعيل نجح
    inline bool VerifyKey(const std::string& key, std::string& messageOut) {
        CURL* curl = curl_easy_init();
        if (!curl) {
            messageOut = "Failed to initialize connection.";
            return false;
        }

        std::string hwid = GetHWID();
        std::string jsonBody = "{\"key\":\"" + key + "\",\"hwid\":\"" + hwid + "\"}";
        std::string response;

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_setopt(curl, CURLOPT_URL, SERVER_URL.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);

        CURLcode res = curl_easy_perform(curl);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            messageOut = "Connection error. Check your internet.";
            return false;
        }

        // تحقق بسيط من نص الرد بدون مكتبة JSON خارجية
        bool success = response.find("\"success\":true") != std::string::npos;

        // استخراج رسالة الرد (بين "message":" و ")
        size_t msgPos = response.find("\"message\":\"");
        if (msgPos != std::string::npos) {
            msgPos += 11;
            size_t endPos = response.find("\"", msgPos);
            messageOut = response.substr(msgPos, endPos - msgPos);
        }
        else {
            messageOut = success ? "Activated" : "Verification failed";
        }

        return success;
    }

    // دالة جاهزة تعرضها أول شي بالبرنامج - تطلب المفتاح وتتحقق منه
    // ترجع true لو التفعيل نجح، وبهذي الحالة تكمل تشغيل باقي البرنامج
    inline bool PromptAndVerify() {
        std::string key;
        std::cout << "===================================\n";
        std::cout << "   NIRVANA TWEAK - Activation\n";
        std::cout << "===================================\n";
        std::cout << "Enter your key: ";
        std::cin >> key;

        std::cout << "\nVerifying...\n";

        std::string message;
        bool ok = VerifyKey(key, message);

        if (ok) {
            std::cout << "[+] " << message << "\n";
            Sleep(800);
            return true;
        }
        else {
            std::cout << "[-] " << message << "\n";
            Sleep(2000);
            return false;
        }
    }

} // namespace KeyCheck
