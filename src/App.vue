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
  listUpdateTask: null,
  textsUpdateTask: null,
})

// Initialize settings
let storage = window.localStorage;
if (storage.getItem('obs_password')) {
  state.password = storage.getItem('obs_password');
}

state.socket = io('wss://peer.vjoi.cn');
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
  state.obs.on('SourceRenamed', (source) => {
    if (source.sourceType !== 'input') {
      return
    }
    console.log('souce renamed');
    console.log('renamed', source)
    if (state.obsTexts.has(source.previousName)) {
      let origin = state.obsTexts.get(source.previousName)
      state.obsTexts.set(source.newName, origin)
      state.obsTexts.delete(source.previousName)
    }
  });
  state.obs.connect({ address: 'localhost:4444', password: state.password }).then(()=>{
    state.obsconnected = true
    startUpdateTasks()
    storage.setItem('obs_password', state.password);
  })
  .catch(err=>{
    switch(err.code){
      case 'CONNECTION_ERROR':
        alert('连接OBS失败，请确保OBS已启动且安装好了Websocket插件');
        break
      default:
        console.log(err);
        if (err.error === 'Authentication Failed.') {
          alert('OBS密码错误');
        } else {
          alert('OBS连接失败: ',+JSON.stringify(err));
        }
    }
  });
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
      if (err.code == 'NOT_CONNECTED') {
        state.obsconnected = false
        state.obs = null
        state.obsTexts = new Map()
        stopUpdateTasks()
      } else if (err.error == "specified source doesn't exist") {
        state.obsTexts.delete(name)
      }
    });
  }
}

function setTextProperties(method, name, text) {
  if (state.obs) {
    state.obs.send(method, { source: name, text: text }).then(()=> {
      console.log('obs update',`[${name}}]`, text)
    }).catch(err => {
      if (err.code == 'NOT_CONNECTED') {
        state.obsconnected = false
        state.obs = null
        state.obsTexts = new Map()
        stopUpdateTasks()
      }
    });
  }
}

function textInput(e, name) {
  if (state.obsTexts.has(name)) {
    let origin = state.obsTexts.get(name)
    setTextProperties(origin.set_method, name, e.target.value)
  } else {
    // Not exist in local obs, just broadcast
    broadcast({name: name, value: e.target.value});
  }
}

function updateTexts() {
  for (const [k,v] of state.obsTexts) {
    getTextProperties(v.get_method, k, v)
  }
}
</script>

<template>
<el-container>
  <el-aside>
    <div class="title">🍊 JOBS TextSync</div>
    <el-divider/>
    <el-form label-position="top" v-if="!state.obsconnected">
      <el-form-item label="OBS密码">
        <el-input v-model="state.password" type="password"></el-input>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="connectOBS">连接OBS</el-button>
      </el-form-item>
      <el-form-item label="说明">
        <span>
        1. 安装<el-link type="primary" href="https://obsproject.com/forum/resources/obs-websocket-remote-control-obs-studio-from-websockets.466/">OBS Websocket插件</el-link>
        </span>
        <span>
        2. 重新启动OBS，并在OBS菜单中找到 工具-Websockets 服务器设置，设置好密码
        </span>
        <span>
        3. 连接OBS，请注意页面只显示名称以#开头的文本源
        </span>
      </el-form-item>
    </el-form>
    <div v-else style="font-size: 14px;">
      <div style="color: green; margin-bottom: 10px;"> OBS 已连接，右侧为房间中的所有文本源。</div>
      <span style="color:orange;font-weight: bold;">橙色</span>表示在自己的OBS中存在该文本源
    </div>
    <el-divider/>
    <el-form label-position="top" v-if="!state.hostconnected">
      <el-form-item label="房间名">
        <el-input type="text" v-model="state.room"/>
      </el-form-item>
      <el-form-item label="房间密码">
        <el-input type="password" v-model="state.roomPassword"/>
      </el-form-item>
      <el-form-item>
        <el-button @click="joinRoom" type="primary">进入房间</el-button>
      </el-form-item>
      <el-form-item label="说明">
        必须输入房间名和密码，才能进入房间；如果房间名不存在，则使用该密码创建房间。
      </el-form-item>
    </el-form>
    <el-form v-else>
      <el-form-item label="房间名">{{state.room}}</el-form-item>
      <el-form-item label="房间人数">{{state.userlist.length}}</el-form-item>
      <div class="userlist-item" v-for="(user, index) in state.userlist" :key="index">🍊 {{user}}</div>
    </el-form>
    <el-form style="position: absolute; bottom: 0px;">
      <el-form-item label="ID" v-if="state.initialized">
        {{ state.currentID }}
      </el-form-item>
    </el-form>
  </el-aside>
  <el-main>
    <div v-if="state.allTexts.size > 0">
      <el-form label-position="top" v-for="(v,i) in state.allTexts" class="text-entry">
        <el-form-item :label="v[0]" v-bind:class="{active: state.obsTexts.has(v[0])}"><textarea @input="textInput($event,v[0])" v-model="v[1]"></textarea></el-form-item>
      </el-form>
    </div>
  </el-main>
</el-container>
</template>

<style>
html,
body {
  margin: 0;
  height: 100%;
}

#app {
  height: 100%;
}

.el-container {
  height: 100%;
}

.el-aside {
  height: 100%;
  padding: 10px;
  border-right: 1px solid var(--el-border-color);
}

.title {
  font-size: 28px;
  font-weight: bold;
  margin-top: 10px;
}

.active label {
  font-weight: bold;
  color: orange;
}

.userlist-item {
  cursor: pointer;
  border-radius: 5px;
  padding: 5px;
  font-size: var(--font-size);
  color: black;
}

.userlist-item:hover{
  background-color: #ffeac3;
}

textarea {
    position: relative;
    display: block;
    resize: vertical;
    padding: 5px 15px;
    line-height: 1.5;
    box-sizing: border-box;
    width: 100%;
    font-size: inherit;
    font-family: inherit;
    color: var(--el-input-text-color,var(--el-text-color-regular));
    background-color: var(--el-input-bg-color,var(--el-fill-color-blank));
    background-image: none;
    box-shadow: 0 0 0 1px var(--el-input-border-color,var(--el-border-color)) inset;
    border-radius: var(--el-input-border-radius,var(--el-border-radius-base));
    transition: var(--el-transition-box-shadow);
    border: none;
}
</style>
