import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { Purchases } from '@revenuecat/purchases-capacitor';

const native = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();
const ANDROID_PRECISE_LOCATION = Object.freeze({ permissions: ['location'] });
const ensureAndroidPreciseLocation = async () => {
  if (platform !== 'android') return null;
  return Geolocation.requestPermissions(ANDROID_PRECISE_LOCATION);
};
window.RAIL_APP = native;
window.RAIL_APP_PLATFORM = native ? platform : 'web';
if (native && document.documentElement) document.documentElement.dataset.appPlatform = platform;
window.RAIL_FFLATE_URL = 'vendor/fflate.js';

if (native) {
  window.RAIL_API_BASE = 'https://railisland.tw/';
  window.RAIL_FIREBASE_MODULE_URL = './vendor/firebase.mjs';

  if (platform === 'android') {
    // 註冊 backButton listener 後 Capacitor 不再執行預設返回行為，所以前端先用可取消事件
    // 收自己的浮層；沒有浮層接手時，再依 canGoBack 回上一頁或把 App 收到背景。
    App.addListener('backButton', ({ canGoBack }) => {
      const event = new CustomEvent('rail:native-back', { cancelable: true });
      window.dispatchEvent(event);
      if (event.defaultPrevented) return;
      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    });
  }

  if (platform === 'ios' || platform === 'android') {
    const RailPlaces = registerPlugin('RailPlaces');
    window.RAIL_NATIVE_PLACES = {
      sync: places => RailPlaces.sync({ places })
    };
  }

  if (platform === 'android') {
    const RailStore = registerPlugin('RailStore');
    window.RAIL_NATIVE_APPUPDATE = { check: () => RailStore.checkUpdate() };
  }

  if (platform === 'ios' || platform === 'android') {
    const RailLiveActivity = registerPlugin(platform === 'ios' ? 'RailLiveActivity' : 'RailFollowLive');
    window.RAIL_NATIVE_LIVEACTIVITY = {
      start: p => RailLiveActivity.start(p),
      update: p => RailLiveActivity.update(p),
      end: () => RailLiveActivity.end(),
      addListener: (ev, cb) => RailLiveActivity.addListener(ev, cb),
    };
  }

  if (platform === 'ios' || platform === 'android') {
    // 原生背景音樂（RailAudioPlugin）：佇列與自動接下一首在原生層，
    // 跟車時讓位（收播放卡）、平時鎖定畫面有播放卡。index.html 以 shim 對接（makeNativeMusicShim）。
    const RailAudio = registerPlugin('RailAudio');
    window.RAIL_NATIVE_AUDIO = {
      setQueue: p => RailAudio.setQueue(p),
      play: p => RailAudio.play(p),
      resume: () => RailAudio.resume(),
      pause: () => RailAudio.pause(),
      setVolume: v => RailAudio.setVolume({ v }),
      addListener: (ev, cb) => RailAudio.addListener(ev, cb),
    };
  }

  window.RAIL_NATIVE_AUTH = {
    // legacy=true 時 Google 改走傳統帳號選擇畫面(見下方長註解)。Apple 不受影響——它在 Android 上
    // 走的是 Firebase 的 startActivityForSignInWithProvider(瀏覽器 OAuth),跟這條路徑毫無交集,
    // 這也是「Google 沒反應但 Apple 有反應」在結構上唯一說得通的解釋。
    async signIn(provider, legacy) {
      const options = { skipNativeAuth: true, scopes: ['email', 'name'] };
      if (provider === 'apple') return FirebaseAuthentication.signInWithApple(options);
      // 2026-08-30:多位 Android 使用者回報「點 Google 登入完全沒反應,連錯誤訊息都沒有」。
      // Android 的 Google 登入預設走 Credential Manager,而 plugin 那條路徑有兩處不保證回覆:
      // 成功處理只認 GOOGLE_ID_TOKEN 型別、沒有 else 分支;憑證解析是在自建的 executor 執行緒上
      // 做的,拋錯不會 reject。兩者都讓 PluginCall 永遠不 resolve/reject ⇒ 前端 await 永遠不回,
      // 畫面上什麼都不會發生(連 catch 裡的紅字都不會出現)。
      // 退路刻意【不自動觸發】:正常流程的 promise 本來就要等使用者選完帳號才 settle,任何逾時
      // 都分不出「卡死」與「還在選帳號」,自動退路只會在使用者面前同時開兩個登入流程。改由前端
      // 逾時後給一個出口,使用者按了才走這裡(見 index.html accountSignIn 的 signinStuck)。
      // useCredentialManager:false 走傳統 GoogleSignIn Intent——它是 Activity result,取消或失敗
      // 一定回得來,結構上不會靜默卡住。需要的 SHA-1 與 Credential Manager 同一組(已登記四把)。
      const opts = { skipNativeAuth: true };
      if (legacy && platform === 'android') opts.useCredentialManager = false;
      return FirebaseAuthentication.signInWithGoogle(opts);
    },
    async revokeApple(credential) {
      const token = platform === 'ios' ? credential?.authorizationCode : credential?.accessToken;
      if (!token) throw new Error('Apple 重新登入沒有回傳可撤銷的授權憑證');
      await FirebaseAuthentication.revokeAccessToken({ token });
    }
  };

  window.RAIL_NATIVE_GEOLOCATION = {
    async requestPermissions() {
      const result = platform === 'android'
        ? await ensureAndroidPreciseLocation()
        : await Geolocation.requestPermissions();
      return result.location;
    },
    async checkPermissions() {
      const result = await Geolocation.checkPermissions();
      return result.location;
    },
    async getCurrentPosition(options) {
      await ensureAndroidPreciseLocation();
      return Geolocation.getCurrentPosition(options);
    },
    // 藍點跟隨與校正旅程都只在前景連續取樣，走 When-in-use；鎖屏／退到背景才需要的 Always 權限不在本功能範圍。
    // 錯誤也回給前端，否則錄製黑幕上只會永遠停在「等待定位」，使用者無從補救。
    async watchPosition(options, cb) {
      await ensureAndroidPreciseLocation();
      return Geolocation.watchPosition(options,
        (pos, err) => cb(pos || null, err || null));
    },
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
