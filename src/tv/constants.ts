/**
 * 本项目为 Android TV 专属分支：所有遥控器媒体键、D-pad 方向键导航、可见焦点框等
 * TV 适配默认常开，不再依赖运行时的 `Platform.isTV`（它仅在 TV 硬件上为 true，
 * 会导致在非 TV 真机/模拟器上无法验证 TV 行为）。
 *
 * 统一以本常量作为唯一开关，便于后续在需要时整体切换。
 */
export const IS_TV = true
