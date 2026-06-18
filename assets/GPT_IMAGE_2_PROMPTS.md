# gpt-image-2 批量素材提示词

当前项目已接入 `assets/generated/` 下的 gpt-image-2 PNG 水墨像素资产，保证所有界面不空白且风格统一。若后续需要重新生成，可继续按下列提示词批量生成 206 个 PNG 素材并替换同名资产。

统一前缀见 [STYLE_PROMPT.md](STYLE_PROMPT.md)。

## 导入与校验流程

1. 按下方文件名把 gpt-image-2 生成的 PNG 放入 `assets/gpt-image-2/ready/`，保持相同子目录，例如 `assets/gpt-image-2/ready/scenes/mortal.png`。
2. 运行 `npm run import:gpt-assets`。脚本会校验 PNG 格式与最小尺寸，复制到 `assets/generated/`，并写入 `assets/generated/gpt-image-2-manifest.json`。
3. 运行 `npm run verify:gpt-assets`。只有 manifest 标明 `model: "gpt-image-2"` 且 206 个 PNG 均存在时才通过。
4. 运行 `npm run screenshots:after` 与 `npm run verify`，确认真实位图接入后的界面和功能仍通过。

## 场景背景

1. `scenes/mortal.png`
   - 水墨像素国风游戏横向场景，中原山脚小镇，远山、客栈、石径、薄雾，人间暖调，宣纸质感，留白充足，无文字。
2. `scenes/cultivation.png`
   - 水墨像素国风游戏横向场景，深山道场与洞府，黛青色温，灵气淡雾，修仙阶段，低饱和，无文字。
3. `scenes/immortal.png`
   - 水墨像素国风游戏横向场景，月白云海、世外桃源、远处仙山，清冷空灵，大量留白，无文字。
4. 地区与历练扩展场景：为中原、江南、塞外、西域、巴蜀、岭南各生成 4 张可轮换主场景，共 24 张，例如古卷楼、烟雨湖、狼关、流沙宫、蜀道、南海遗墟等。
5. 修行与仙界扩展场景：洞府静修、试剑台、炼丹殿、灵泉、门派内院，以及云门、月宫、星河渡口、玉台等 9 张。

## 角色

1. `portraits/hero-mortal.png`：寒门武者立绘，布衣短打，低饱和苔绿与赭石，像素块清晰。
2. `portraits/hero-cultivation.png`：修仙阶段主角立绘，黛青道袍，松烟墨线，留白。
3. `portraits/hero-immortal.png`：飞升阶段主角立绘，月白衣袍，清冷淡光。
4. `portraits/mentor.png`：师父立绘，沉静长者，松烟墨袍。
5. `portraits/spouse.png`：配偶立绘，温润克制，赭石暖调。
6. `portraits/child.png`：子嗣立绘，少年/少女中性，苔绿生机。
7. `portraits/nemesis.png`：仇敌立绘，朱砂只作少量衣纹点缀。
8. `portraits/benefactor.png`：恩人立绘，黛青与宣纸色。
9. 主角阶段扩展立绘：少年、游侠、门派弟子、风霜中年、剑修、丹修、宗师、渡劫、云上仙、月袍仙、飞升武仙，共 11 张，用于随年龄、门派、境界和飞升状态动态切换。
10. 女性主角阶段立绘：女童、少女、女侠游历者、成年女武者、女性门派弟子、年长女主角、女性宗师、女性修士、女性仙人，共 9 张。
11. 女性关系头像：女性配偶、女性子嗣、女性师长、女性恩人、女性宿敌，共 5 张。

## 装备与丹药

1. `equipment/equipment_000.png` 至 `equipment/equipment_059.png`：逐件装备生成方形图标，武器、护具、佩饰保持材质和轮廓清楚，适合装备格与放大预览。
2. `pills/pill_000.png` 至 `pills/pill_047.png`：逐种丹药生成方形或近方形图标，药丸、瓷碟、木匣、药草碎屑等元素区分类型和用途。

## 门派

为少林、武当、峨眉、华山、昆仑、崆峒、青城、点苍各生成一张山门标识。真实历史门派名可作为文件名，图中不出现文字，使用建筑轮廓/山形/小印章区分。

## 事件配图

1. `events/tribulation.png`：渡劫，压暗天色，克制劫雷，朱砂闪电，庄重。
2. `events/family.png`：婚育/家人，烛火案头，温暖低饱和。
3. `events/encounter.png`：奇遇，崖洞/残卷/薄雾，传奇但克制。
4. `events/ascension.png`：飞升，月白云海，白光升腾，留白。

## 图标

方形 128px，透明或宣纸底，统一像素墨线：机缘、仙缘、境界、心境、门派、功法、装备、丹药、江湖地图、婚育、史册、护身玉符、护道莲台、续命灯。

## UI 纹理

1. `ui/paper-grain.png`：可平铺宣纸纹理。
2. `ui/seal-template.png`：朱砂谥号印章模板，无文字。
3. `ui/scroll-rod.png`：卷轴轴头与横杆，可用于命书/手札。

## 当前接入状态

- 2026-06-18 已通过 imagegen CLI / gpt-image-2 将 206 张素材批量输出到 `assets/generated/`，其中包含 60 张装备、48 张丹药、女性主角阶段立绘和女性关系头像。
- `assets/generated/gpt-image-2-manifest.json` 已记录完整清单，`npm run verify:gpt-assets` 通过。
- 当前 UI 默认使用 `assets/generated/**/*.png`，不再依赖 SVG 回退。
