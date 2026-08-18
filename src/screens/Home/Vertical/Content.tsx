import { useEffect, useRef, useState } from 'react'
// import { getWindowSise, onDimensionChange } from '@/utils/tools'
import DrawerNav from './DrawerNav'
import Header from './Header'
import Main from './Main'
import { useSettingValue } from '@/store/setting/hook'
import { COMPONENT_IDS } from '@/config/constant'
import DrawerLayoutFixed, { type DrawerLayoutFixedType } from '@/components/common/DrawerLayoutFixed'
import { scaleSizeW } from '@/utils/pixelRatio'
import { IS_TV } from '@/tv/constants'

const MAX_WIDTH = scaleSizeW(300)

const Content = () => {
  const drawer = useRef<DrawerLayoutFixedType>(null)
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')
  const [menuVisible, setMenuVisible] = useState(false)

  useEffect(() => {
    const changeVisible = (visible: boolean) => {
      setMenuVisible(visible)
      if (visible) {
        drawer.current?.openDrawer()
      } else {
        drawer.current?.closeDrawer()
      }
    }

    global.app_event.on('changeMenuVisible', changeVisible)

    return () => {
      global.app_event.off('changeMenuVisible', changeVisible)
    }
  }, [])

  // Android TV：抽屉是覆盖层，仅在打开时挂载导航视图，避免 DrawerLayoutAndroid 的抽屉面
  // 始终作为 D-pad 焦点候选而抢占遥控器焦点（导致主内容/搜索输入框无法定位）。
  const navigationView = () => (IS_TV && !menuVisible) ? null : <DrawerNav />

  // console.log('render drawer content')

  return (
    <DrawerLayoutFixed
      ref={drawer}
      widthPercentage={0.7}
      widthPercentageMax={MAX_WIDTH}
      visibleNavNames={[COMPONENT_IDS.home]}
      // drawerWidth={width}
      drawerPosition={drawerLayoutPosition}
      renderNavigationView={navigationView}
    >
      <Header />
      <Main />
      {/* <View style={styles.container}>
      </View> */}
    </DrawerLayoutFixed>
  )
}
// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
// })

export default Content
