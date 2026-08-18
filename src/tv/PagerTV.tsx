/**
 * Android TV / 遥控器方向键翻页封装（阶段 2）
 *
 * 包装 react-native-pager-view：Android TV 专属分支，PagerView 获得焦点时，
 * 用左右方向键翻页（替代滑动手势）。方向键监听默认常开（见 ./constants 的 IS_TV）。
 *
 * 用法与 PagerView 一致（透传 ref / onPageSelected / 子页面），额外暴露 setPage。
 */
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react'
import { View, type ViewProps } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent, type PagerViewProps } from 'react-native-pager-view'

import { type TVKeyEvent } from './Focusable'
import { IS_TV } from './constants'

export interface PagerTVHandle {
  setPage: (index: number) => void
}

export interface PagerTVProps extends Omit<PagerViewProps, 'onKeyDown'> {
  children?: ReactNode
  style?: ViewProps['style']
  onPageSelected?: (e: PagerViewOnPageSelectedEvent) => void
}

const KEYCODE_DPAD_LEFT = 21
const KEYCODE_DPAD_RIGHT = 22

const PagerTV = forwardRef<PagerTVHandle, PagerTVProps>(({ children, style, onPageSelected, ...props }, ref) => {
  const pagerRef = useRef<PagerView>(null)
  const pageRef = useRef(0)

  useImperativeHandle(ref, () => ({
    setPage: (index: number) => {
      pagerRef.current?.setPage(index)
      pageRef.current = index
    },
  }), [])

  const handleKeyDown = (e: TVKeyEvent) => {
    const keyCode = e.nativeEvent?.keyCode
    if (keyCode == KEYCODE_DPAD_LEFT) {
      if (pageRef.current > 0) {
        pagerRef.current?.setPage(pageRef.current - 1)
        return true
      }
    } else if (keyCode == KEYCODE_DPAD_RIGHT) {
      pagerRef.current?.setPage(pageRef.current + 1)
      return true
    }
    return false
  }

  // RN 0.73 类型未导出 onKeyDown / focusable，但它们是 Android 原生视图的有效属性（运行时可用）。
  const tvExtraProps: { focusable?: boolean; onKeyDown?: (e: TVKeyEvent) => void } = IS_TV
    ? { focusable: true, onKeyDown: handleKeyDown }
    : {}

  return (
    <View style={style} {...(tvExtraProps as object)}>
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        {...props}
        onPageSelected={(e) => {
          pageRef.current = e.nativeEvent.position
          onPageSelected?.(e)
        }}
      >
        {children}
      </PagerView>
    </View>
  )
})

export default PagerTV
