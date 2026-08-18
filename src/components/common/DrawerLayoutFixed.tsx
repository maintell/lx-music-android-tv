import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { DrawerLayoutAndroid, type DrawerLayoutAndroidProps, View, type LayoutChangeEvent } from 'react-native'
// import { getWindowSise } from '@/utils/tools'
import { usePageVisible } from '@/store/common/hook'
import { type COMPONENT_IDS } from '@/config/constant'

interface Props extends DrawerLayoutAndroidProps {
  visibleNavNames: COMPONENT_IDS[]
  widthPercentage: number
  widthPercentageMax?: number
  /** Android TV：抽屉打开/关闭状态变化回调（用于把焦点请求进抽屉内容） */
  onOpenChange?: (open: boolean) => void
}

export interface DrawerLayoutFixedType {
  openDrawer: () => void
  closeDrawer: () => void
  fixWidth: () => void
}

const DrawerLayoutFixed = forwardRef<DrawerLayoutFixedType, Props>(({ visibleNavNames, widthPercentage, widthPercentageMax, children, onOpenChange, onDrawerOpen, onDrawerClose, ...props }, ref) => {
  const drawerLayoutRef = useRef<DrawerLayoutAndroid>(null)
  const [w, setW] = useState<number | `${number}%`>('100%')
  const [drawerWidth, setDrawerWidth] = useState(0)
  const changedRef = useRef({ width: 0, changed: false })

  // Android TV：抽屉动画真正打开/关闭后回调（此时抽屉内容才附着并可见，
  // 调用方可在此时把焦点请求进抽屉内的可选项）。
  const handleDrawerOpen = useCallback(() => {
    onOpenChange?.(true)
    onDrawerOpen?.()
  }, [onOpenChange, onDrawerOpen])
  const handleDrawerClose = useCallback(() => {
    onOpenChange?.(false)
    onDrawerClose?.()
  }, [onOpenChange, onDrawerClose])

  const fixDrawerWidth = useCallback(() => {
    if (!changedRef.current.width) return
    changedRef.current.changed = true
    // console.log('usePageVisible', visible, changedRef.current.width)
    setW(changedRef.current.width - 1)
  }, [])

  // 修复 DrawerLayoutAndroid 在导航到其他屏幕再返回后无法打开的问题
  usePageVisible(visibleNavNames, useCallback((visible) => {
    if (!visible || !changedRef.current.width) return
    fixDrawerWidth()
  }, [fixDrawerWidth]))

  useImperativeHandle(ref, () => ({
    openDrawer() {
      drawerLayoutRef.current?.openDrawer()
    },
    closeDrawer() {
      drawerLayoutRef.current?.closeDrawer()
    },
    fixWidth() {
      fixDrawerWidth()
    },
  }), [fixDrawerWidth])


  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    // console.log('handleLayout', e.nativeEvent.layout.width, changedRef.current.width)
    if (changedRef.current.changed) {
      // setW(e.nativeEvent.layout.width - 1)
      setW('100%')
      changedRef.current.changed = false
    } else {
      const width = e.nativeEvent.layout.width
      if (changedRef.current.width == width) return
      changedRef.current.width = width

      // 重新设置面板宽度
      const wp = Math.floor(width * widthPercentage)
      // console.log(wp, widthPercentageMax)
      setDrawerWidth(widthPercentageMax ? Math.min(wp, widthPercentageMax) : wp)

      // 强制触发渲染以应用更改
      changedRef.current.changed = true
      setW(width - 1)
    }
  }, [widthPercentage, widthPercentageMax])

  return (
    <View
      onLayout={handleLayout}
      style={{ width: w, flex: 1 }}
    >
      <DrawerLayoutAndroid
        ref={drawerLayoutRef}
        keyboardDismissMode="on-drag"
        drawerWidth={drawerWidth}
        onDrawerOpen={handleDrawerOpen}
        onDrawerClose={handleDrawerClose}
        {...props}
      >
        <View style={{ marginRight: w == '100%' ? 0 : -1, flex: 1 }}>
          {children}
        </View>
      </DrawerLayoutAndroid>
    </View>
  )
})

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
// })

export default DrawerLayoutFixed
