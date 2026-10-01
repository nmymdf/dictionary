package tw.archiekuo.danciben;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 單字本：把網頁版包成 App。
 * 網頁檔案放在 assets/www，用 https://appassets.androidplatform.net/ 開（有正常的網址，資料庫和線上查詢都能用）。
 * 發音、存檔、分享進來由這裡提供給網頁（window.AndroidApp）。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 1;

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setTextZoom(100);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(true);

        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { js("window.__ttsEnd && window.__ttsEnd()"); }
                    @Override public void onError(String id) { js("window.__ttsEnd && window.__ttsEnd()"); }
                });
                js("window.__ttsReady && window.__ttsReady()");
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            String shared = sharedText(getIntent());
            web.loadUrl(shared == null ? HOME : HOME + "?text=" + Uri.encode(shared));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String shared = sharedText(intent);
        if (shared != null) js("window.__shareIn && window.__shareIn(" + JSONObject.quote(shared) + ")");
    }

    private static String sharedText(Intent intent) {
        if (intent == null) return null;
        CharSequence t = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) t = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        else if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) t = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (t == null) return null;
        String s = t.toString().trim();
        return s.isEmpty() ? null : s;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    private void js(String code) {
        runOnUiThread(() -> web.evaluateJavascript(code, null));
    }

    /* ---------- 網頁檔案 ---------- */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            try {
                InputStream in = getAssets().open("www" + path);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime(path), "utf-8", 200, "OK", headers, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { /* 沒有瀏覽器 */ }
            return true;
        }
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /* ---------- 選檔案（匯入 JSON / Word） ---------- */
    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, "選擇檔案"), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int k = 0; k < n; k++) result[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    /* ---------- 給網頁用的功能 ---------- */
    private class Bridge {
        /** 英文語音清單：[{name, lang, local}]，裝在手機上的排前面。 */
        @JavascriptInterface
        public String voices() {
            JSONArray arr = new JSONArray();
            if (!ttsReady) return arr.toString();
            try {
                Set<Voice> all = tts.getVoices();
                if (all == null) return arr.toString();
                List<Voice> en = new ArrayList<>();
                for (Voice v : all) {
                    if (v.getLocale() != null && "en".equals(v.getLocale().getLanguage())
                            && !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) en.add(v);
                }
                Collections.sort(en, (a, b) -> {
                    int c = Boolean.compare(a.isNetworkConnectionRequired(), b.isNetworkConnectionRequired());
                    if (c != 0) return c;
                    c = Integer.compare(b.getQuality(), a.getQuality());
                    return c != 0 ? c : a.getName().compareTo(b.getName());
                });
                for (Voice v : en) {
                    JSONObject o = new JSONObject();
                    o.put("name", v.getName());
                    o.put("lang", v.getLocale().toLanguageTag());
                    o.put("local", !v.isNetworkConnectionRequired());
                    arr.put(o);
                }
            } catch (Exception e) { /* 回傳目前有的 */ }
            return arr.toString();
        }

        @JavascriptInterface
        public boolean speak(String text, String lang, float rate, String voiceName) {
            if (!ttsReady || text == null) return false;
            boolean set = false;
            if (voiceName != null && !voiceName.isEmpty()) {
                Set<Voice> all = tts.getVoices();
                if (all != null) for (Voice v : all) {
                    if (v.getName().equals(voiceName)) { set = tts.setVoice(v) == TextToSpeech.SUCCESS; break; }
                }
            }
            if (!set) {
                int r = tts.setLanguage(Locale.forLanguageTag(lang == null || lang.isEmpty() ? "en-US" : lang));
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                    r = tts.setLanguage(Locale.US);
                    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) return false;
                }
            }
            tts.setSpeechRate(rate > 0 ? rate : 1f);
            return tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "u" + System.nanoTime()) == TextToSpeech.SUCCESS;
        }

        @JavascriptInterface
        public void stop() {
            if (ttsReady) tts.stop();
        }

        /** 存到「下載/單字本」，再開分享選單（可以 Quick Share 到電腦）。 */
        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                ContentResolver cr = getContentResolver();
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/單字本");
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return "fail";
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) return "fail";
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("application/json");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> {
                    try { startActivity(Intent.createChooser(send, "傳送備份檔")); } catch (ActivityNotFoundException e) { /* 已經存好了 */ }
                });
                return "saved";
            } catch (Exception e) {
                return "fail";
            }
        }

        /** 代抓 Yahoo 字典網頁（網頁本身不能跨網站讀取），抓完呼叫 window.__nativeFetchDone。 */
        @JavascriptInterface
        public void fetchText(String id, String url) {
            new Thread(() -> {
                int status = 0;
                String finalUrl = url;
                String text = "";
                if (url != null && url.startsWith("https://tw.dictionary.search.yahoo.com/")) {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        c.setInstanceFollowRedirects(true);
                        c.setConnectTimeout(5000);
                        c.setReadTimeout(6000);
                        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36");
                        c.setRequestProperty("Accept-Language", "zh-TW,zh;q=0.9,en;q=0.8");
                        status = c.getResponseCode();
                        finalUrl = c.getURL().toString();
                        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in != null) {
                            ByteArrayOutputStream buf = new ByteArrayOutputStream();
                            byte[] b = new byte[16384];
                            int n;
                            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                            in.close();
                            text = buf.toString("UTF-8");
                        }
                    } catch (Exception e) {
                        status = 0;
                    } finally {
                        if (c != null) c.disconnect();
                    }
                }
                js("window.__nativeFetchDone && window.__nativeFetchDone(" + JSONObject.quote(id) + "," + status + ","
                        + JSONObject.quote(finalUrl) + "," + JSONObject.quote(text) + ")");
            }).start();
        }

        /** 讓狀態列、導覽列跟著白底／黑底。 */
        @JavascriptInterface
        public void setDark(boolean dark) {
            runOnUiThread(() -> {
                Window w = getWindow();
                int bg = dark ? Color.parseColor("#121816") : Color.parseColor("#f7f8f6");
                w.setStatusBarColor(bg);
                w.setNavigationBarColor(bg);
                web.setBackgroundColor(bg);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController c = w.getInsetsController();
                    if (c != null) {
                        int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        c.setSystemBarsAppearance(dark ? 0 : mask, mask);
                    }
                } else {
                    View d = w.getDecorView();
                    int f = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    d.setSystemUiVisibility(dark ? 0 : f);
                }
            });
        }
    }
}
