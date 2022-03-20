<script setup>
import {io} from 'socket.io-client';
import { reactive } from 'vue';

const state = reactive({
  initialized: false, 
  password:'', 
  currentID:'', 
  socket: null,
  room:'', 
  roomPassword:'',
  obs: null, 
  userlist: [],
  obsTexts: new Map(),
  allTexts: new Map(),
  obsconnected: false, 
  hostconnected: false,
  warns: {
    warnPassword: false,
    warnConnection: false,
  },
  listUpdateTask: null,
  textsUpdateTask: null,
})

state.socket = io('ws://192.168.50.198:9000');
state.socket.on('update_text', onData);
state.socket.on('joined',(room)=>{
  state.room = room;
  state.hostconnected = true;
});
state.socket.on('userlist_update',(users)=>{
  console.log(users);
  state.userlist = users;
});
state.socket.on('error', (msg)=>{
  alert(msg);
})

state.socket.on('connect', ()=>{
  state.initialized = true;
  state.currentID = state.socket.id
  state.warns.warnConnection = false;
});

function broadcast(data) {
  if (state.room !== '') {
    console.log('broadcast', data);
    state.socket.emit('update_text', data);
  }
}

function joinRoom() {
  if (state.room !== '' && state.roomPassword !== '') {
    let texts = [];
    for (let [key, value] of state.obsTexts) {
      texts.push({name: key, value: value.value});
    }
    console.log(texts);
    state.socket.emit('join',state.room, state.roomPassword, texts);
  }
}

function onData(data) {
  console.log(data);
  let key = data.name
  let value = data.value
  if (state.obsTexts.has(key)) {
    let origin = state.obsTexts.get(key)
    if (origin.value !== value) {
      origin.value = value
      state.obsTexts.set(key, origin)
      state.obsTexts = state.obsTexts
      setTextProperties(origin.set_method,key, value)
    }
  }
  state.allTexts.set(key, value);
}

function connectOBS() {
  state.obs = new OBSWebSocket();
  state.obs.on('AuthenticationFailure', () => {
    console.log('failed')
    state.warns.warnPassword = true
  });
  state.obs.on('AuthenticationSuccess', () => {
    state.obsconnected = true
    state.warns.warnPassword = false
    startUpdateTasks()
  });
  state.obs.on('SourceRenamed', (source) => {
    if (source.sourceType !== 'input') {
      return
    }
    console.log('renamed', source)
    if (state.obsTexts.has(source.previousName)) {
      let origin = state.obsTexts.get(source.previousName)
      state.obsTexts.set(source.newName, origin)
      state.obsTexts.delete(source.previousName)
    }
  });
  state.obs.connect({ address: 'localhost:4444', password: state.password });
}

function startUpdateTasks() {
  updateTextList()
  setTimeout(()=>{
    updateTexts()
    setTimeout(()=>{
      state.listUpdateTask = setInterval(updateTextList, 1000);
      state.textsUpdateTask = setInterval(updateTexts, 1000);
    }, 1000)
  }, 1000)
}

function stopUpdateTasks() {
  clearInterval(state.listUpdateTask);
  clearInterval(state.textsUpdateTask);
}

function updateTextList() {
  if (state.obs) {
      state.obs.send('GetSourcesList', {}).then(data => {
        data.sources.filter(source => source.typeId === 'text_gdiplus_v2' || source.typeId === 'text_ft2_source_v2').forEach(source => {
          if (source.name[0] == '#') {
            if (!state.obsTexts.has(source.name)) {
              if (source.typeId === 'text_gdiplus_v2') {
                state.obsTexts.set(source.name, {
                  get_method: 'GetTextGDIPlusProperties',
                  set_method: 'SetTextGDIPlusProperties',
                  value: null
                })
              } else {
                state.obsTexts.set(source.name, {
                  get_method: 'GetTextFreetype2Properties',
                  set_method: 'SetTextFreetype2Properties',
                  value: null
                })
              }
            }
          }
        })
      });
  }
}

function getTextProperties(method, name,origin) {
  if (state.obs) {
    state.obs.send(method, { source: name }).then(data => {
      let text = data.text || ''
      state.allTexts.set(name, text);
      if (origin.value !== null) {
        if (origin.value !== text) {
          origin.value = text
          state.obsTexts.set(name, origin)
          console.log('text update',`[${name}}]`, "->", text)
          broadcast({name: name, value: text})
        }
      } else {
        origin.value = text
        state.obsTexts.set(name, origin)
        console.log('text update',`[${name}}]`,"->", text)
        broadcast({name: name, value: text})
      }
    }).catch(err => {
      console.log(err)
    });
  }
}

function setTextProperties(method, name, text) {
  if (state.obs) {
    state.obs.send(method, { source: name, text: text }).then(()=> {
      console.log('obs update',`[${name}}]`, text)
    }).catch(err => {
      console.log('obs update error',`[${name}}]`, text, err)
    });
  }
}

function textInput(event, name) {
  if (state.obsTexts.has(name)) {
    let origin = state.obsTexts.get(name)
    setTextProperties(origin.set_method, name, event.target.value)
  } else {
    // Not exist in local obs, just broadcast
    broadcast({name: name, value: event.target.value});
  }
}

function updateTexts() {
  for (const [k,v] of state.obsTexts) {
    getTextProperties(v.get_method, k, v)
  }
}
</script>

<template>
<div class="main-content">
  <main v-if="!state.obsconnected">
    <div class="title orange">🍊OBS TextSync</div> 
    <div>
      <input type="password" placeholder="OBS密码" v-model="state.password"/>
      <button @click="connectOBS">连接OBS</button>
    </div>
    <div>请首先确保OBS安装了所需的插件（obs-websocket），<a href="https://github.com/obsproject/obs-websocket/releases/tag/4.9.1">点击此处下载</a></div>
    <div v-if="state.warns.warnPassword">密码错误</div>
  </main>
  <main v-else>
    <div style="margin-bottom:10px;">OBS已连接, 共享了{{state.obsTexts.size}}个文本</div>
    <div v-if="!state.hostconnected" style="margin-bottom:10px;">
      <input type="text" placeholder="Room ID" v-model="state.room"/>
      <input type="text" placeholder="Room Password" v-model="state.roomPassword"/>
      <button @click="joinRoom">连接</button>
    </div>
    <div v-else>
      <div>房间ID: {{state.room}}</div>
      <div>房间人数: {{state.userlist.length}}</div>
      <li v-for="(user, index) in state.userlist" :key="index">{{user}}</li>
    </div>
  </main>
  <div class="text-list" v-if="state.allTexts.size > 0">
    <div v-for="(v,i) in state.allTexts" class="text-entry" v-bind:class="{active: state.obsTexts.has(v[0])}">
      <label>{{v[0]}}<textarea @input="textInput($event,v[0])" rows="3" style="width:100%" v-model="v[1]"></textarea></label>
    </div>
  </div>
</div>
  <div class="peer-id" v-if="state.initialized">
    <h3>ID: {{ state.currentID }}</h3>
  </div>
</template>

<style>
@import '@/assets/base.css';

#app {
  display: flex;
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  align-items: center;
  justify-content: center;
  font-weight: normal;
}

main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

header {
  line-height: 1.5;
  max-height: 100vh;
}

.text-entry.active {
  color: orange;
}

.title {
  font-size: 4rem;
  font-weight: bold;
  margin-bottom: 1rem;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

.peer-id {
  display: flex;
  position: fixed;
  bottom: 10px;
  right: 10px;
}

.peer-id button {
  margin-left: 5px;
}

a,
.orange {
  text-decoration: none;
  color: rgb(255, 153, 0);
  transition: 0.4s;
}

@media (hover: hover) {
  a:hover {
    background-color: hsla(160, 100%, 37%, 0.2);
  }
}

nav {
  width: 100%;
  font-size: 12px;
  text-align: center;
  margin-top: 2rem;
}

nav a.router-link-exact-active {
  color: var(--color-text);
}

nav a.router-link-exact-active:hover {
  background-color: transparent;
}

nav a {
  display: inline-block;
  padding: 0 1rem;
  border-left: 1px solid var(--color-border);
}

nav a:first-of-type {
  border: 0;
}

@media (min-width: 1024px) {
  body {
    display: flex;
    place-items: center;
  }

  #app {
    padding: 0 2rem;
  }

  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  nav {
    text-align: left;
    margin-left: -1rem;
    font-size: 1rem;

    padding: 1rem 0;
    margin-top: 1rem;
  }
  
  .main-content {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
  }


  .text-list {
    display: flex;
    flex-direction: column;
    align-items: left;
    justify-content: center;
    padding: 1rem;
    margin-left: 2rem;
    border: 1px solid var(--color-border);
  }
}
</style>
