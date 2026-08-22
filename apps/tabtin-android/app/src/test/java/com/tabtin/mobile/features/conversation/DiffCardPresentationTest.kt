package com.tabtin.mobile.features.conversation

import com.tabtin.mobile.features.conversation.cards.DiffCardPresentation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 与 iOS `ToolDiffDetailBody` 同口径：编辑类工具即便只发 old/new 也要有 diff 可看。 */
class DiffCardPresentationTest {

    @Test
    fun `synthesizes diff from old and new string`() {
        val input = """{"file_path":"a/b/Main.kt","old_string":"val a = 1","new_string":"val a = 2"}"""
        val diff = DiffCardPresentation.diff(input, outputJson = null)

        assertEquals(
            listOf("--- old", "+++ new", "-val a = 1", "+val a = 2"),
            diff?.lines(),
        )
    }

    @Test
    fun `synthesized diff yields add and remove counts`() {
        val input = """{"path":"x.kt","old_string":"a\nb","new_string":"a\nb\nc"}"""
        val lines = DiffCardPresentation.contentLines(DiffCardPresentation.diff(input, null)!!)

        // `--- old` / `+++ new` 头部不计入增删。
        assertEquals(3, DiffCardPresentation.addedCount(lines))
        assertEquals(2, DiffCardPresentation.removedCount(lines))
    }

    @Test
    fun `explicit diff wins over synthesis`() {
        val input = """{"path":"x.kt","diff":"@@ -1 +1 @@\n-old\n+new","old_string":"a","new_string":"b"}"""

        assertEquals("@@ -1 +1 @@\n-old\n+new", DiffCardPresentation.diff(input, null))
    }

    @Test
    fun `falls back to result diff then raw output`() {
        val onlyResult = DiffCardPresentation.diff(
            inputJson = """{"path":"x.kt"}""",
            outputJson = """{"patch":"-a\n+b"}""",
        )
        assertEquals("-a\n+b", onlyResult)

        val onlyRaw = DiffCardPresentation.diff(
            inputJson = """{"path":"x.kt"}""",
            outputJson = null,
            fallback = "plain text",
        )
        assertEquals("plain text", onlyRaw)
    }

    @Test
    fun `ignores content field so writes do not shadow synthesis`() {
        // content 是写文件工具的整文件内容，抢在合成前会把编辑卡变成没有 +/- 的纯文本。
        val input = """{"path":"x.kt","content":"whole file","old_string":"a","new_string":"b"}"""

        assertEquals(listOf("--- old", "+++ new", "-a", "+b"), DiffCardPresentation.diff(input, null)?.lines())
    }

    @Test
    fun `truncates replacement preview at eighty lines per side`() {
        val old = (1..200).joinToString("\n") { "old$it" }
        val new = (1..200).joinToString("\n") { "new$it" }
        val lines = DiffCardPresentation.replacementPreview(old, new).lines()

        assertEquals(2 + 80 + 80 + 1, lines.size)
        assertTrue(lines.last().contains("truncated"))
    }

    @Test
    fun `missing one side skips synthesis`() {
        assertNull(DiffCardPresentation.replacementPreview("""{"old_string":"a"}"""))
        assertNull(DiffCardPresentation.replacementPreview("""{"new_string":"b"}"""))
        assertNull(DiffCardPresentation.diff("""{"path":"x.kt"}""", null))
    }

    @Test
    fun `path accepts every ios key spelling`() {
        assertEquals("a.kt", DiffCardPresentation.path("""{"path":"a.kt"}"""))
        assertEquals("b.kt", DiffCardPresentation.path("""{"file_path":"b.kt"}"""))
        assertEquals("c.kt", DiffCardPresentation.path("""{"filePath":"c.kt"}"""))
        assertEquals("d.kt", DiffCardPresentation.path("""{"target_file":"d.kt"}"""))
        assertEquals("e.kt", DiffCardPresentation.path("""{"file":"e.kt"}"""))
        assertNull(DiffCardPresentation.path("""{"path":"null"}"""))
        assertNull(DiffCardPresentation.path("not json"))
    }
}
