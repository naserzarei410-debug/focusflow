package com.focusflow.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

/**
 * Direct bridge to Android's system TextToSpeech engine — the same engine
 * used by the OS "Read aloud" / "خواندن با صدای بلند" action. This bypasses
 * third-party Capacitor TTS plugins when they fail to wire correctly.
 */
@CapacitorPlugin(name = "DeviceTts")
public class DeviceTtsPlugin extends Plugin {

    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean initFailed = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ArrayList<PluginCall> pending = new ArrayList<>();

    @Override
    public void load() {
        mainHandler.post(() -> {
            try {
                tts = new TextToSpeech(getContext(), status -> {
                    if (status == TextToSpeech.SUCCESS) {
                        ready = true;
                        initFailed = false;
                        try {
                            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                                @Override
                                public void onStart(String utteranceId) { /* no-op */ }

                                @Override
                                public void onDone(String utteranceId) {
                                    // resolved per-call when speak finishes via listener below
                                }

                                @Override
                                public void onError(String utteranceId) { /* no-op */ }
                            });
                        } catch (Exception ignored) { }

                        // Flush any calls that arrived before init finished
                        synchronized (pending) {
                            for (PluginCall call : pending) {
                                doSpeak(call);
                            }
                            pending.clear();
                        }
                    } else {
                        ready = false;
                        initFailed = true;
                        synchronized (pending) {
                            for (PluginCall call : pending) {
                                call.reject("TTS engine init failed with status " + status);
                            }
                            pending.clear();
                        }
                    }
                });
            } catch (Exception e) {
                initFailed = true;
                ready = false;
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) { }
            tts = null;
        }
        super.handleOnDestroy();
    }

    private Locale localeFromTag(String tag) {
        if (tag == null || tag.trim().isEmpty()) {
            return Locale.US;
        }
        String normalized = tag.trim().replace('_', '-');
        try {
            // API 21+: forLanguageTag understands BCP-47 (en-US, fa-IR, ar-SA)
            Locale loc = Locale.forLanguageTag(normalized);
            if (loc != null && loc.getLanguage() != null && !loc.getLanguage().isEmpty()) {
                return loc;
            }
        } catch (Exception ignored) { }

        String[] parts = normalized.split("-");
        if (parts.length >= 2) {
            return new Locale(parts[0], parts[1]);
        }
        return new Locale(parts[0]);
    }

    private void doSpeak(PluginCall call) {
        if (tts == null || !ready) {
            call.reject("TTS not ready");
            return;
        }

        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("empty text");
            return;
        }
        // Keep utterances reasonable for flashcards
        if (text.length() > 3500) {
            text = text.substring(0, 3500);
        }

        String lang = call.getString("lang", "en-US");
        float rate = 1.0f;
        try {
            Double rateD = call.getDouble("rate");
            if (rateD != null) {
                rate = rateD.floatValue();
            }
        } catch (Exception ignored) { }
        if (rate < 0.5f) rate = 0.5f;
        if (rate > 1.5f) rate = 1.5f;

        Locale primary = localeFromTag(lang);
        int avail = tts.setLanguage(primary);

        // If requested language data is missing, try fallbacks
        if (avail == TextToSpeech.LANG_MISSING_DATA
                || avail == TextToSpeech.LANG_NOT_SUPPORTED) {
            String base = primary.getLanguage();
            Locale[] fallbacks;
            if ("fa".equals(base)) {
                fallbacks = new Locale[] {
                    new Locale("fa", "IR"),
                    new Locale("fa"),
                    Locale.US
                };
            } else if ("ar".equals(base)) {
                fallbacks = new Locale[] {
                    new Locale("ar", "SA"),
                    new Locale("ar"),
                    Locale.US
                };
            } else {
                fallbacks = new Locale[] { Locale.US, Locale.UK, Locale.getDefault() };
            }

            boolean ok = false;
            for (Locale fb : fallbacks) {
                int a = tts.setLanguage(fb);
                if (a != TextToSpeech.LANG_MISSING_DATA && a != TextToSpeech.LANG_NOT_SUPPORTED) {
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                // Last resort: default engine language
                try {
                    tts.setLanguage(Locale.getDefault());
                } catch (Exception ignored) { }
            }
        }

        try {
            tts.setSpeechRate(rate);
            tts.setPitch(1.0f);
        } catch (Exception ignored) { }

        final String utteranceId = UUID.randomUUID().toString();
        final PluginCall activeCall = call;

        try {
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) { /* speaking */ }

                @Override
                public void onDone(String id) {
                    if (utteranceId.equals(id)) {
                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        activeCall.resolve(ret);
                    }
                }

                @Override
                public void onError(String id) {
                    if (utteranceId.equals(id)) {
                        activeCall.reject("TTS utterance error");
                    }
                }
            });
        } catch (Exception ignored) { }

        Bundle params = new Bundle();
        int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);

        if (result == TextToSpeech.ERROR) {
            call.reject("tts.speak returned ERROR");
            return;
        }

        // Some devices never fire onDone; resolve after a safety timeout so JS does not hang.
        // Estimate ~80ms per character, min 3s max 30s
        long waitMs = Math.min(30000, Math.max(3000, text.length() * 80L));
        mainHandler.postDelayed(() -> {
            try {
                // If still speaking, leave it; only resolve if call not already finished.
                // PluginCall resolves only once safely in Capacitor.
                JSObject ret = new JSObject();
                ret.put("ok", true);
                activeCall.resolve(ret);
            } catch (Exception ignored) { }
        }, waitMs);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (initFailed) {
            call.reject("TTS engine failed to initialize");
            return;
        }
        if (!ready) {
            // Queue until onInit fires
            synchronized (pending) {
                pending.add(call);
            }
            // Safety: if init never comes, reject
            mainHandler.postDelayed(() -> {
                synchronized (pending) {
                    if (pending.contains(call)) {
                        pending.remove(call);
                        call.reject("TTS init timed out");
                    }
                }
            }, 8000);
            return;
        }
        doSpeak(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) {
            try {
                tts.stop();
            } catch (Exception ignored) { }
        }
        call.resolve();
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", ready);
        ret.put("failed", initFailed);
        call.resolve(ret);
    }
}
