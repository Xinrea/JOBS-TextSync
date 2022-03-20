import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

import App from './App.vue'

window.Buffer = Buffer;
window.EventEmitter = EventEmitter;

const app = createApp(App)

app.use(createPinia())

app.mount('#app')
