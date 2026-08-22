package com.tabtin.mobile.features.conversation.cards

import androidx.compose.runtime.Composable
import com.tabtin.mobile.data.model.AgentStep
import com.tabtin.mobile.data.model.StepStatus
import com.tabtin.mobile.data.model.StepType

private val TERMINAL_TOOLS = setOf(
    "bash", "terminal_execute", "execute_command", "shell", "run_command",
)
private val SSH_TOOLS = setOf("ssh", "ssh_execute", "remote_execute")
// 文件家族的成员名以 tests/mobile-contract/fixtures/tool-row/vocabulary.json 为准（全小写，
// 因为分发前统一 lowercase）。此前少了 edit / multiedit / apply_patch / str_replace，
// 最常见的 `Edit` 反而落到 GenericToolCardView，编辑文件时看不到 diff。
private val DIFF_TOOLS = setOf(
    "file_edit", "apply_diff", "edit_file", "edit", "multiedit", "apply_patch",
    "str_replace", "str_replace_editor", "patch",
)
private val FILE_READ_TOOLS = setOf(
    "file_read", "read_file", "read", "document_read", "parse_document",
    "cat_file", "view_file",
)
private val FILE_WRITE_TOOLS = setOf("file_write", "write_file", "create_file", "write")
private val SQL_TOOLS = setOf("execute_sql", "sql_execute", "query_sql", "run_sql")
private val WEB_SEARCH_TOOLS = setOf("web_search", "search_web", "google_search")
private val CODE_SEARCH_TOOLS = setOf(
    "code_search", "grep", "ripgrep", "search_code", "find_code",
    "semantic_search", "glob",
)
private val RECORD_TOOLS = setOf(
    "create_record", "update_record", "delete_record",
    "batch_create_records", "batch_update_records", "batch_delete_records",
)

/**
 * 卡片分发时的家族归属。暴露给契约测试，让夹具里的 family 名单和这里的 set 绑死——
 * `Edit` 曾因为不在 [DIFF_TOOLS] 里而静默落到通用卡，编辑文件时整张 diff 都不见了。
 */
internal object ToolCardFamily {
    fun isDiff(name: String): Boolean = name.lowercase() in DIFF_TOOLS
    fun isFileRead(name: String): Boolean = name.lowercase() in FILE_READ_TOOLS
    fun isFileWrite(name: String): Boolean = name.lowercase() in FILE_WRITE_TOOLS
}

/**
 * 失败时工具结果原文能否进卡片。
 *
 * 对齐 Electron：通用工具的失败原文一律不渲染（桌面 `ErrorBanner` 在生产构建里直接
 * `return null`），否则 envelope JSON 会被摊成一排 `success: false` / `error_kind: …`
 * 推给用户；终端 / SSH 保留 exit code 与 stdout/stderr，这是桌面唯一的既有例外。
 *
 * 与 iOS `ToolFailureOutputPolicy` 同口径。
 */
internal object ToolFailureOutputPolicy {
    fun showsRawResult(name: String, status: StepStatus): Boolean {
        if (status != StepStatus.FAILED) return true
        val lowered = name.lowercase()
        return lowered in TERMINAL_TOOLS || lowered in SSH_TOOLS
    }
}

@Composable
internal fun ToolCardContent(step: AgentStep) {
    if (step.type != StepType.TOOL_CALL) return
    if (step.status == StepStatus.RUNNING && step.input.isNullOrBlank() && step.output.isNullOrBlank()) {
        LoadingPlaceholderView(lines = 2)
        return
    }

    // 失败原文在分发前就剥掉，让所有卡片共用同一条口径，而不是各自判 FAILED。
    // 入参仍然渲染——那是「AI 打算做什么」，不是失败噪声。
    val visible = if (ToolFailureOutputPolicy.showsRawResult(step.name, step.status)) {
        step
    } else {
        step.copy(output = null)
    }

    val name = visible.name.lowercase()
    when {
        name in TERMINAL_TOOLS || name in SSH_TOOLS -> TerminalCardView(visible, isSsh = name in SSH_TOOLS)
        name in DIFF_TOOLS -> DiffCardView(visible)
        name in FILE_READ_TOOLS -> FileReadCardView(visible)
        name in FILE_WRITE_TOOLS -> FileWriteCardView(visible)
        name in SQL_TOOLS -> SqlResultCardView(visible)
        name in WEB_SEARCH_TOOLS -> WebSearchCardView(visible)
        name in CODE_SEARCH_TOOLS -> CodeSearchCardView(visible)
        name in RECORD_TOOLS -> RecordOpCardView(visible)
        else -> GenericToolCardView(visible)
    }
}

internal fun parseJson(raw: String?): org.json.JSONObject? = try {
    raw?.trim()?.takeIf { it.startsWith("{") }?.let { org.json.JSONObject(it) }
} catch (_: Exception) { null }
