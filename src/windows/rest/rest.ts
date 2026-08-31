import { createApp } from "vue";
import { createPinia } from "pinia";
import RestApp from "./RestApp.vue";
import "../../styles/base.css";

const app = createApp(RestApp);
app.use(createPinia());
app.mount("#app");
