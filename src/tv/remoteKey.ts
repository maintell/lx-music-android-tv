/**
 * Android TV 遥控器媒体键适配层（阶段 1）
 *
 * 原生侧 `MainActivity.dispatchKeyEvent` 在 TV 设备上拦截媒体键（KEYCODE_MEDIA_*），
 * 经 DeviceEventEmitter 转发到本模块；本模块映射到既有 `core/player` 动作函数。
 *
 * 设计依据见 docs/modules/tv-adaptation.md：
 * - 复用 ADR-2/3：遥控器与触摸共用同一套 core 动作，禁止在此重写播放逻辑。
 * - Android TV 专属分支：监听默认常开（见 ./constants 的 IS_TV）。
 *
 * 注意：若 TrackPlayer fork 的 MediaSession 已自行接管媒体键（含后台/锁屏），
 * 原生侧不会走到 dispatchKeyEvent 转发（系统优先投递 MediaSession），本模块作为
 * 兜底/显式路径。阶段 2 的 D-pad 方向键导航不在此处理。
 */
import { DeviceEventEmitter } from 'react-native'

import {
  togglePlay,
  pause,
  stop,
  playNext,
  playPrev,
} from '@/core/player/player'
import { IS_TV } from './constants'

const TV_REMOTE_MEDIA_KEY_EVENT = 'onTVRemoteMediaKey'

const KeyCode = {
  KEYCODE_MEDIA_PLAY_PAUSE: 85,
  KEYCODE_MEDIA_PLAY: 126,
  KEYCODE_MEDIA_PAUSE: 127,
  KEYCODE_MEDIA_STOP: 86,
  KEYCODE_MEDIA_NEXT: 87,
  KEYCODE_MEDIA_PREVIOUS: 88,
  KEYCODE_MEDIA_FAST_FORWARD: 90,
  KEYCODE_MEDIA_REWIND: 89,
} as const

const handleMediaKey = (keyCode: number) => {
  switch (keyCode) {
    case KeyCode.KEYCODE_MEDIA_PLAY_PAUSE:
      void togglePlay()
      break
    case KeyCode.KEYCODE_MEDIA_PLAY:
      void togglePlay()
      break
    case KeyCode.KEYCODE_MEDIA_PAUSE:
      void pause()
      break
    case KeyCode.KEYCODE_MEDIA_STOP:
      void stop()
      break
    case KeyCode.KEYCODE_MEDIA_NEXT:
    case KeyCode.KEYCODE_MEDIA_FAST_FORWARD:
      void playNext()
      break
    case KeyCode.KEYCODE_MEDIA_PREVIOUS:
    case KeyCode.KEYCODE_MEDIA_REWIND:
      void playPrev()
      break
    default:
      break
  }
}

/**
 * 在 TV 设备上挂载遥控器媒体键监听。手机端为 no-op。
 *
 * 注意：这是一个普通函数，而非 React Hook。它在 core/init 启动流程中（非组件渲染上下文）
 * 被调用，若其中使用 useEffect 会触发 "Invalid hook call / Cannot read property 'useEffect' of null"。
 * 因此这里直接以 DeviceEventEmitter 注册监听，并由 subscribed 守卫避免重复注册。
 *
 * 应在播放核心初始化完成（initPlayer）之后调用，确保动作函数可用。
 */
let subscribed = false
export default () => {
  if (!IS_TV || subscribed) return
  subscribed = true
  DeviceEventEmitter.addListener(TV_REMOTE_MEDIA_KEY_EVENT, handleMediaKey)
}
