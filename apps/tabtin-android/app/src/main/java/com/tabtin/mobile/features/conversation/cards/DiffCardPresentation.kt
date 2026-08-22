package com.tabtin.mobile.features.conversation.cards

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 编辑类工具的 diff 取值口径，与 iOS `ToolDiffDetailBody` 逐条对齐。
 *
 * 关键一条是 [replacementPreview]：大多数编辑工具（`Edit` / `str_replace` / `MultiEdit`）
 * 根本不发 unified diff，只发 `old_string` + `new_string`。iOS 会把这两段合成一份
 * `--- old / +++ new` 的伪 diff 再上色，安卓此前缺这一层，于是编辑文件时整张卡是空的。
 *
 * 刻意不用 org.json：它在 Android 的 JVM 单测里只是 stub（调用即抛 "not mocked"），
 * 会让本口径无法被单测覆盖。
 */
internal object DiffCardPresentation {
    /** 与 iOS `replacementPreview` 同上限：old / new 各取前 80 行。 */
    private const val MAX_REPLACEMENT_LINES = 80

    private val PATH_KEYS = listOf("path", "file_path", "filePath", "target_file", "file")
    private val DIFF_KEYS = listOf("diff", "patch")
    private val OLD_KEYS = listOf("old_string", "oldText", "old")
    private val NEW_KEYS = listOf("new_string", "newText", "new", "replacement")

    fun path(inputJson: String?): String? = firstString(inputJson, PATH_KEYS)

    /**
     * 取值顺序与 iOS 一致：入参 diff/patch → 结果 diff/patch → old/new 合成 → 结果原文兜底。
     *
     * 注意不看 `content`——那是写文件工具的整文件内容，抢在合成之前会把编辑卡变成一段
     * 没有 +/- 的纯文本。
     */
    fun diff(inputJson: String?, outputJson: String?, fallback: String? = null): String? =
        firstString(inputJson, DIFF_KEYS)
            ?: firstString(outputJson, DIFF_KEYS)
            ?: replacementPreview(inputJson)
            ?: fallback?.trim()?.takeIf { it.isNotEmpty() }

    /** 从入参里的 old/new 合成伪 diff；缺任一侧则返回 null，交给 caller 兜底。 */
    fun replacementPreview(inputJson: String?): String? {
        val old = firstString(inputJson, OLD_KEYS) ?: return null
        val new = firstString(inputJson, NEW_KEYS) ?: return null
        return replacementPreview(old, new)
    }

    fun replacementPreview(old: String, new: String): String {
        val oldLines = old.split("\n")
        val newLines = new.split("\n")
        val lines = mutableListOf("--- old", "+++ new")
        oldLines.take(MAX_REPLACEMENT_LINES).forEach { lines += "-$it" }
        newLines.take(MAX_REPLACEMENT_LINES).forEach { lines += "+$it" }
        if (oldLines.size > MAX_REPLACEMENT_LINES || newLines.size > MAX_REPLACEMENT_LINES) {
            lines += "… replacement preview truncated"
        }
        return lines.joinToString("\n")
    }

    /** 剔掉 diff 头噪声（`@@` / `diff --git` / `index`），其余按 +/- 上色。 */
    fun contentLines(diff: String): List<String> = diff.lines().filterNot { line ->
        line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")
    }

    fun addedCount(contentLines: List<String>): Int =
        contentLines.count { it.startsWith("+") && !it.startsWith("+++") }

    fun removedCount(contentLines: List<String>): Int =
        contentLines.count { it.startsWith("-") && !it.startsWith("---") }

    private val parser = Json { ignoreUnknownKeys = true; isLenient = true }

    private fun firstString(json: String?, keys: List<String>): String? {
        val root = objectOf(json) ?: return null
        for (key in keys) {
            val primitive = root[key] as? JsonPrimitive ?: continue
            val value = primitive.content.trim()
            if (value.isNotEmpty() && value != "null") return value
        }
        return null
    }

    private fun objectOf(json: String?): JsonObject? {
        val raw = json?.trim()?.takeIf { it.startsWith("{") } ?: return null
        return runCatching { parser.parseToJsonElement(raw) as? JsonObject }.getOrNull()
    }
}
