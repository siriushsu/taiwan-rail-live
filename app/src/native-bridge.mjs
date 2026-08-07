import { Capacitor, registerPlugin } from '@capacitor/core';
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

  if (platform === 'ios') {
    const RailPlaces = registerPlugin('RailPlaces');
    window.RAIL_NATIVE_PLACES = {
      sync: places => RailPlaces.sync({ places })
    };

    const RailLiveActivity = registerPlugin('RailLiveActivity');
    window.RAIL_NATIVE_LIVEACTIVITY = {
      start: p => RailLiveActivity.start(p),
      update: p => RailLiveActivity.update(p),
      end: () => RailLiveActivity.end(),
      addListener: (ev, cb) => RailLiveActivity.addListener(ev, cb),
    };
  }

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
    getCurrentPosition: options => Geolocation.getCurrentPosition(options),
    // 校正旅程只在前景連續取樣，走 When-in-use；鎖屏／退到背景才需要的 Always 權限不在本功能範圍。
    // 錯誤也回給前端，否則錄製黑幕上只會永遠停在「等待定位」，使用者無從補救。
    watchPosition: (options, cb) =>
      Geolocation.watchPosition(options, (pos, err) => cb(pos || null, err || null)),
    clearWatch: id => Geolocation.clearWatch({ id }),
    // Capacitor Geolocation 沒有開啟系統設定頁的 API；前端見 null 時改顯示純文字引導
    // （與同檔 RAIL_NATIVE_LOCALNOTIFY.openSettings 的既有做法一致）。
    openSettings: null
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
      restore: () => Purchases.restorePurchases(),
      // 退費/撤銷/到期後資格持續有效的止血(C-4):讓 index.html 訂閱 SDK 主動推播的 CustomerInfo
      // 更新,不必等下次登入或使用者手動開 Plus 面板才發現資格變了。型別宣告
      // (@revenuecat/purchases-capacitor/dist/esm/definitions.d.ts:253):
      //   addCustomerInfoUpdateListener(customerInfoUpdateListener: CustomerInfoUpdateListener): Promise<PurchasesCallbackId>
      // callback 收到的是「裸」CustomerInfo,不經 { customerInfo } 包裝鍵——已對照兩端原生實作逐行核實,
      // 不是只憑型別宣告猜的:iOS PurchasesPlugin.swift 的 `purchases(_:receivedUpdated:)` 呼叫
      // `call.resolve(CommonFunctionality.encode(customerInfo: customerInfo))`(無 wrapperKey);
      // Android PurchasesPlugin.kt 的 addCustomerInfoUpdateListener 同樣直接 resolveWithMap 未經
      // wrapperKey。這與 getCustomerInfo() 不同——那條原生實作走的是帶 wrapperKey 的
      // getCompletionBlockHandler,才需要上面的 unwrap()。
      addCustomerInfoUpdateListener: listener => Purchases.addCustomerInfoUpdateListener(listener),
      removeCustomerInfoUpdateListener: listenerToRemove => Purchases.removeCustomerInfoUpdateListener({ listenerToRemove }),
    };
  }
}
