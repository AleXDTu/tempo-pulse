import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "../../styles/base.css";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");

// macOS 通知权限在主窗首次启动时申请一次
(async () => {
  try {
    if (!(await isPermissionGranted())) {
      await requestPermission();
    }
  } catch {
    // 权限接口不可用时静默，通知发送在 Rust 侧容错
  }
})();
