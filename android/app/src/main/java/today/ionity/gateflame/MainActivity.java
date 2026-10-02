package today.ionity.gateflame;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

/**
 * Gate^Flame mobile companion.
 *
 * The one piece of native behaviour this app has: holding a Wi-Fi multicast
 * lock while the app is in the foreground.
 *
 * WHY. The node advertises itself over mDNS as gateflame.local, and the web
 * layer finds it by resolving that name. mDNS is multicast. Most Android Wi-Fi
 * drivers drop multicast frames in their power-saving filter unless some app on
 * the device holds a multicast lock, and the OS's own resolver does not take
 * one on the app's behalf. On those handsets `.local` discovery fails quietly
 * and the customer is left typing an IP address into the pairing screen.
 *
 * The manifest has declared CHANGE_WIFI_MULTICAST_STATE for this purpose since
 * the app was created, and nothing ever acquired the lock - the permission sat
 * there describing a benefit the app did not deliver (found 2026-10-02). This
 * class makes the declaration true. It costs a little battery while the app is
 * on screen, which is why the lock is released in onPause rather than held for
 * the life of the process.
 *
 * Everything else - every screen, every request - lives in the web layer.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "GateFlame";
    private static final String LOCK_TAG = "today.ionity.gateflame:mdns";

    private WifiManager.MulticastLock multicastLock;

    @Override
    public void onResume() {
        super.onResume();
        acquireMulticastLock();
    }

    @Override
    public void onPause() {
        releaseMulticastLock();
        super.onPause();
    }

    private void acquireMulticastLock() {
        try {
            if (multicastLock == null) {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi == null) {
                    return;
                }
                multicastLock = wifi.createMulticastLock(LOCK_TAG);
                // Not reference-counted: one acquire, one release, however many
                // times the lifecycle bounces.
                multicastLock.setReferenceCounted(false);
            }
            if (!multicastLock.isHeld()) {
                multicastLock.acquire();
            }
        } catch (RuntimeException e) {
            // A handset without Wi-Fi hardware, or an OEM that refuses the lock.
            // Discovery then relies on the remembered address and the candidate
            // list, exactly as it did before this class existed.
            Log.w(TAG, "multicast lock not acquired: " + e.getMessage());
        }
    }

    private void releaseMulticastLock() {
        try {
            if (multicastLock != null && multicastLock.isHeld()) {
                multicastLock.release();
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "multicast lock not released: " + e.getMessage());
        }
    }
}
