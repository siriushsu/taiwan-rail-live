import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { Purchases } from '@revenuecat/purchases-capacitor';

const native = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();
window.RAIL_APP = native;
window.RAIL_FFLATE_URL = 'vendor/fflate.js';

if (native) {
  window.RAIL_API_BASE = 'https://railisland.tw/';
  window.RAIL_FIREBASE_MODULE_URL = './vendor/firebase.mjs';

  window.RAIL_NATIVE_AUTH = {
    async signIn(provider) {
      const options = { skipNativeAuth: true, scopes: ['email', 'name'] };
      return provider === 'apple'
        ? FirebaseAuthentication.signInWithApple(options)
        : FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
    },
    async revokeApple(credential) {
      const token = platform === 'ios' ? credential?.authorizationCode : credential?.accessToken;
      if (!token) throw new Error('Apple 重新登入沒有回傳可撤銷的授權憑證');
      await FirebaseAuthentication.revokeAccessToken({ token });
    }
  };

  window.RAIL_NATIVE_GEOLOCATION = {
    getCurrentPosition: options => Geolocation.getCurrentPosition(options)
  };

  window.RAIL_NATIVE_LOCALNOTIFY = {
    async requestPermissions() {
      const result = await LocalNotifications.requestPermissions();
      return result.display;
    },
    async checkPermissions() {
      const result = await LocalNotifications.checkPermissions();
      return result.display;
    },
    schedule: list => LocalNotifications.schedule({ notifications: list }),
    cancel: ids => LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) }),
    async getPending() {
      const result = await LocalNotifications.getPending();
      return result.notifications || [];
    },
    // LocalNotifications 8.x 沒有開啟 App 設定頁的 API；前端見 null 時改顯示純文字引導。
    openSettings: null
  };

  window.RAIL_NATIVE_SHARE = {
    share: options => Share.share(options)
  };

  const rc = window.RAIL_REVENUECAT_CONFIG || {};
  const apiKey = platform === 'ios' ? rc.iosApiKey : (platform === 'android' ? rc.androidApiKey : '');
  if (rc.entitlement && apiKey) {
    let configured = false;
    let currentUid = '';
    const unwrap = result => result && result.customerInfo ? result.customerInfo : result;
    window.RAIL_NATIVE_PLUS_ADAPTER = {
      async setUser(uid) {
        if (!configured) {
          await Purchases.configure({ apiKey, appUserID: uid });
          configured = true; currentUid = uid; return;
        }
        if (currentUid !== uid) { await Purchases.logIn({ appUserID: uid }); currentUid = uid; }
      },
      async clearUser() {
        if (!configured || !currentUid) return;
        await Purchases.logOut(); currentUid = '';
      },
      async getCustomerInfo() { return unwrap(await Purchases.getCustomerInfo()); },
      getOfferings: () => Purchases.getOfferings(),
      purchase: aPackage => Purchases.purchasePackage({ aPackage }),
      restore: () => Purchases.restorePurchases()
    };
  }
}
