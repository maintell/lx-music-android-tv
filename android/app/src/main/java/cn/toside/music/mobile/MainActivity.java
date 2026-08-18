package cn.toside.music.mobile;

import com.reactnativenavigation.NavigationActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;
import com.reactnativenavigation.NavigationApplication;

import android.app.UiModeManager;
import android.content.res.Configuration;
import android.view.KeyEvent;

import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.modules.core.DeviceEventManagerModule;

public class MainActivity extends NavigationActivity {

    // Android TV 专属分支：遥控器媒体键（播放/暂停、上/下一首、停止等）转发到 JS 层，
    // 由 src/tv/remoteKey.ts 统一映射到 core/player 动作。本项目即 TV 版，媒体键拦截常开。
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                case KeyEvent.KEYCODE_MEDIA_PLAY:
                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                case KeyEvent.KEYCODE_MEDIA_STOP:
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                case KeyEvent.KEYCODE_MEDIA_REWIND:
                    sendMediaKeyToJs(event.getKeyCode());
                    return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void sendMediaKeyToJs(int keyCode) {
        // RNN 的 NavigationActivity 不直接暴露 getReactInstanceManager()，
        // 需经由 Application（实现 ReactApplication）的 ReactNativeHost 取得实例管理器。
        ReactInstanceManager reactInstanceManager = null;
        try {
            NavigationApplication app = (NavigationApplication) getApplication();
            reactInstanceManager = app.getReactNativeHost().getReactInstanceManager();
        } catch (Exception ignored) {
            return;
        }
        if (reactInstanceManager == null) return;
        ReactContext reactContext = reactInstanceManager.getCurrentReactContext();
        if (reactContext == null || !reactContext.hasActiveCatalystInstance()) return;
        reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("onTVRemoteMediaKey", keyCode);
    }

}
