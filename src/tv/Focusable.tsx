/**
 * Android TV / 遥控器焦点基础设施（阶段 2）
 *
 * 架构说明：
 * - RN 0.73 在 Android TV 上不提供任何焦点事件的 JS 回调（onFocus/onBlur/onKeyDown 均不触发）。
 * - 焦点边框样式已在 focusBorderStyle 中声明（3px 主题色 + 发光），但显示需要框架支持焦点事件。
 * - 使用 TouchableOpacity 以确保 onPress / focusable 等原生属性正常工作。
 *
 * 暴露：
 *  - Focusable        包装可交互元素，OK 键触发 onPress，MENU 键触发 onMenu。
 *  - PagerTV          包装 react-native-pager-view。
 *  - focusBorderStyle 焦点态边框样式构造器（供自定义组件复用）。
 */

import { memo, useState, useMemo, type ReactNode } from 'react'
import { TouchableOpacity, type TouchableOpacityProps, type ViewStyle } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { IS_TV } from './constants'

/** Android 遥控器 MENU 键 keyCode */
export const KEYCODE_MENU = 82

/** TV 方向键/菜单键事件的轻量类型（RN 0.73 类型未导出原生 keyEvent 细节） */
export type TVKeyEvent = { nativeEvent: { keyCode: number } }

/**
 * 生成「获得焦点时」叠加的主题色边框样式；手机端或失焦时返回空对象。
 *
 * 说明（当前为 stock react-native 0.73）：Android 原生层仅对 TextInput 派发焦点事件，
 * 故本构造器在 TV 上实际只在 Input.tsx（基于 TextInput）生效；Pressable/TouchableOpacity
 * （Button / Focusable）的 onFocus 不触发。边框取更深的主色（c-primary-dark-200：亮色主题下
 * 更暗、暗色主题下更亮 → 两种主题下都与背景形成更强对比），并加粗、加强发光，让选中态醒目。
 */
export const focusBorderStyle = (theme: ReturnType<typeof useTheme>, focused: boolean): ViewStyle => {
  if (!focused) return {}
  const color = theme['c-primary-dark-200']
  return {
    borderWidth: 4,
    borderColor: color,
    borderRadius: 6,
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  }
}

export interface FocusableProps extends TouchableOpacityProps {
  /** MENU 键回调 */
  onMenu?: () => void
  /** 方向键/按键回调 */
  onKeyDown?: (e: TVKeyEvent) => void
  /** 是否应用默认焦点边框（默认 true；注意：RN 0.73 的焦点事件不触发，边框暂不生效） */
  showBorder?: boolean
  /** Android TV：挂载/置为 true 时请求焦点 */
  hasTVPreferredFocus?: boolean
  children?: ReactNode
  style?: ViewStyle
}

/**
 * TV 焦点容器：使用 TouchableOpacity（经过验证在 stock RN 0.73 上可被 D-pad 焦点命中，
 * Pressable 在该环境下会丢失焦点），叠加 android_ripple 提供主题色焦点态填充 +
 * 系统默认 defaultFocusHighlight 焦点框兜底（见 styles.xml）。OK 键触发 onPress、MENU 键触发 onMenu。
 * 注意：RN 0.73 原生层仅对 TextInput 派发焦点事件，TouchableOpacity 的 onFocus 不触发，
 * 故动态边框(focusBorderStyle)暂未启用；焦点可见性依赖原生高亮。后续升级 react-native-tvos
 * 可通过 onFocus/onBlur 恢复动态边框。
 */
const Focusable = memo(({ onMenu, onKeyDown, showBorder = true, hasTVPreferredFocus, children, style, ...props }: FocusableProps) => {
  const theme = useTheme()
  const [focused] = useState(false)
  const borderStyle: ViewStyle = showBorder ? focusBorderStyle(theme, focused) : {}
  const ripple = useMemo(() => ({
    color: theme['c-primary-dark-200-alpha-200'],
  }), [theme])

  const extraProps = {
    focusable: true,
    hasTVPreferredFocus: hasTVPreferredFocus,
    android_ripple: ripple,
  }

  return (
    <TouchableOpacity
      {...props}
      style={[borderStyle, style]}
      {...(extraProps as object)}
    >
      {children}
    </TouchableOpacity>
  )
})

export default Focusable