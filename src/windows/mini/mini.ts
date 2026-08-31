import { createApp } from "vue";
import { createPinia } from "pinia";
import MiniApp from "./MiniApp.vue";
import "../../styles/base.css";

const app = createApp(MiniApp);
app.use(createPinia());
app.mount("#app");
