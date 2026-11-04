/** 默认属性（模板库）契约：随 user_settings 同步（跟账号走）。
 *  预设只作「添加属性」时的模板库：加进文档后即成为该文档自己的设定，
 *  之后预设怎么改都不回写既有文档（FR-PROP-9）。
 *  形状与属性定义同源（键名/类型/显示名/候选），默认值为新增文档用。 */

export const PROPERTY_TEMPLATES_SETTING_KEY = "propertyTemplates";
