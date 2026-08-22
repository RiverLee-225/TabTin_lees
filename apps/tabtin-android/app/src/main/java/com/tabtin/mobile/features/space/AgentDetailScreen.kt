package com.tabtin.mobile.features.space

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.tabtin.mobile.R
import com.tabtin.mobile.data.model.Agent
import com.tabtin.mobile.data.model.AgentMemoryRecord
import com.tabtin.mobile.data.model.AgentProjectTask
import com.tabtin.mobile.data.model.AgentSkillLink
import com.tabtin.mobile.data.model.AllChatSession
import com.tabtin.mobile.data.model.AgentLocalMcpAttachment
import com.tabtin.mobile.data.model.OrgMcpSourceKind
import com.tabtin.mobile.data.model.VisibleSkillEntry
import com.tabtin.mobile.features.skills.ConnectorBrandGlyph
import com.tabtin.mobile.features.skills.ConnectorBrandIconResolver
import com.tabtin.mobile.ui.components.TTBottomSheet
import com.tabtin.mobile.ui.components.TTSheetColumn
import com.tabtin.mobile.ui.components.TabSearchField
import com.tabtin.mobile.ui.theme.LocalTTDarkTheme
import com.tabtin.mobile.ui.theme.TTColors
import com.tabtin.mobile.ui.theme.TTRadius
import com.tabtin.mobile.ui.theme.TTSpacing
import com.tabtin.mobile.ui.theme.ttColor
import com.tabtin.mobile.util.RelativeTimeFormatter
import kotlinx.coroutines.launch

/** 「最近任务」把 Chat 会话和 Project 任务混在一张时间线里。 */
private sealed interface AgentActivityItem {
    data class Session(val session: AllChatSession) : AgentActivityItem
    data class Task(val task: AgentProjectTask) : AgentActivityItem
}

private fun agentActivityItems(
    sessions: List<AllChatSession>,
    tasks: List<AgentProjectTask>,
): List<AgentActivityItem> =
    sessions.take(10).map(AgentActivityItem::Session) + tasks.take(10).map(AgentActivityItem::Task)

internal fun agentMemoryTypeLabelRes(memoryType: String): Int = when (memoryType.trim().lowercase()) {
    "about_you" -> R.string.my_agents_memory_type_about_you
    "insight" -> R.string.my_agents_memory_type_insight
    "task_summary" -> R.string.my_agents_memory_type_task_summary
    "diary" -> R.string.my_agents_memory_type_diary
    else -> R.string.my_agents_memory
}

internal fun shouldUseAgentMemoryTypeLabel(memoryType: String, title: String): Boolean {
    val normalizedTitle = title.trim()
    val normalizedType = memoryType.trim()
    return normalizedTitle.isEmpty() || normalizedTitle.equals(normalizedType, ignoreCase = true)
}

/**
 * AI分身的移动工作台详情。进入时请求 /agents/{id}，不以列表摘要代替详情真源。
 *
 * 版式为「卡片感」：强调色淡底身份面 + 一列抬起的圆角卡片，每张卡一个区，
 * 不再用顶部标签把四个区藏起来。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun AgentDetailScreen(
    viewModel: AgentDetailViewModel,
    agentsViewModel: MyAgentsViewModel,
    onBack: () -> Unit,
    onOpenChatSession: (
        sessionId: String,
        spaceId: String,
        spaceName: String,
        organizationId: String,
    ) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val agentsState by agentsViewModel.uiState.collectAsState()
    val actionErrorMessage = state.actionErrorRes?.let { stringResource(it) }
    val agentsActionErrorMessage = agentsState.actionErrorRes?.let { stringResource(it) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val portraitViewModel: UserPortraitViewModel = hiltViewModel()
    var editing by remember { mutableStateOf(false) }
    var deactivating by remember { mutableStateOf(false) }
    var forgetTarget by remember { mutableStateOf<AgentMemoryRecord?>(null) }
    var correctTarget by remember { mutableStateOf<AgentMemoryRecord?>(null) }
    var removeSkillTarget by remember { mutableStateOf<AgentSkillLink?>(null) }
    var showSkillPicker by remember { mutableStateOf(false) }
    var isAttachingSkills by remember { mutableStateOf(false) }

    LaunchedEffect(state.actionErrorRes) {
        actionErrorMessage?.let {
            snackbar.showSnackbar(it)
            viewModel.clearActionError()
        }
    }
    LaunchedEffect(agentsState.actionErrorRes) {
        agentsActionErrorMessage?.let {
            snackbar.showSnackbar(it)
            agentsViewModel.clearActionError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.common_tab_agents)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = ttColor(TTColors.Background, TTColors.Dark.Background),
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = agentPageColor(),
    ) { padding ->
        val agent = state.agent
        when {
            state.isLoading && agent == null -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            agent == null -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = stringResource(R.string.my_agents_load_failed),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(TTSpacing.sm))
                    TextButton(onClick = viewModel::refresh) { Text(stringResource(R.string.common_retry)) }
                }
            }

            else -> PullToRefreshBox(
                isRefreshing = state.isRefreshing,
                onRefresh = viewModel::refresh,
                modifier = Modifier.fillMaxSize().padding(padding),
            ) {
                AgentDetailContent(
                    agent = agent,
                    state = state,
                    isIdentityMutating = agentsState.isMutating,
                    onEdit = { editing = true },
                    onAddSkill = {
                        showSkillPicker = true
                        viewModel.loadSkillPicker()
                    },
                    onToggleSkill = viewModel::toggleSkill,
                    onRemoveSkill = { removeSkillTarget = it },
                    onForgetMemory = { forgetTarget = it },
                    onCorrectMemory = { correctTarget = it },
                    portraitViewModel = portraitViewModel,
                    onOpenChatSession = onOpenChatSession,
                    onRetry = viewModel::refresh,
                    onDeactivate = { deactivating = true },
                )
            }
        }
    }

    state.agent?.takeIf { editing }?.let { agent ->
        AgentEditDialog(
            agent = agent,
            isSaving = agentsState.isMutating,
            onDismiss = { editing = false },
            onSave = { name, rules, avatarKey ->
                agentsViewModel.updateAgent(agent.id, name, rules, avatarKey) { updated ->
                    viewModel.applyAgent(updated)
                    editing = false
                }
            },
        )
    }

    state.agent?.takeIf { deactivating }?.let { agent ->
        AlertDialog(
            onDismissRequest = { deactivating = false },
            title = { Text(stringResource(R.string.my_agents_deactivate_title)) },
            text = { Text(stringResource(R.string.my_agents_deactivate_body, agent.detailName())) },
            confirmButton = {
                TextButton(
                    onClick = {
                        agentsViewModel.deactivateAgent(agent.id) {
                            deactivating = false
                            onBack()
                        }
                    },
                    enabled = !agentsState.isMutating,
                ) {
                    Text(
                        text = stringResource(R.string.my_agents_deactivate),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { deactivating = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }

    forgetTarget?.let { memory ->
        AlertDialog(
            onDismissRequest = { forgetTarget = null },
            title = { Text(stringResource(R.string.my_agents_forget_memory_title)) },
            text = { Text(stringResource(R.string.my_agents_forget_memory_body)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        forgetTarget = null
                        viewModel.forgetMemory(memory)
                    },
                ) {
                    Text(stringResource(R.string.my_agents_forget_memory), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { forgetTarget = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }

    correctTarget?.let { memory ->
        MemoryCorrectDialog(
            memory = memory,
            isSaving = memory.id in state.correctingMemoryIds,
            onDismiss = { correctTarget = null },
            onSave = { content ->
                viewModel.correctMemory(memory, content) {
                    correctTarget = null
                }
            },
        )
    }

    removeSkillTarget?.let { skill ->
        AlertDialog(
            onDismissRequest = { removeSkillTarget = null },
            title = { Text(stringResource(R.string.my_agents_remove_skill_title)) },
            text = {
                Text(
                    stringResource(
                        R.string.my_agents_remove_skill_body,
                        skill.name.ifBlank { skill.skillCanonicalKey },
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        removeSkillTarget = null
                        viewModel.removeSkill(skill)
                    },
                ) {
                    Text(stringResource(R.string.my_agents_remove_skill), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { removeSkillTarget = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }

    if (showSkillPicker) {
        AgentSkillPickerSheet(
            candidates = state.skillPickerCandidates,
            attachedKeys = state.skills.map { it.skillCanonicalKey }.toSet(),
            loading = state.isSkillPickerLoading,
            submitting = isAttachingSkills,
            onDismiss = {
                if (!isAttachingSkills) showSkillPicker = false
            },
            onAttachSelected = { selected ->
                if (selected.isEmpty() || isAttachingSkills) return@AgentSkillPickerSheet
                isAttachingSkills = true
                viewModel.attachSkills(selected.map { it.canonicalKey }) { attached ->
                    isAttachingSkills = false
                    if (attached.isEmpty()) return@attachSkills
                    showSkillPicker = false
                    val names = attached.map { link ->
                        link.name.ifBlank { link.skillCanonicalKey }
                    }
                    AgentSkillAttachFeedback.fromNames(names)?.let { feedback ->
                        val message = when (feedback) {
                            is AgentSkillAttachFeedback.Single -> context.getString(
                                R.string.my_agents_skill_added,
                                feedback.name,
                            )
                            is AgentSkillAttachFeedback.Batch -> context.getString(
                                R.string.my_agents_skills_added_batch,
                                feedback.firstName,
                                feedback.count,
                            )
                        }
                        scope.launch {
                            snackbar.showSnackbar(
                                message = message,
                                duration = SnackbarDuration.Short,
                            )
                        }
                    }
                }
            },
        )
    }
}

@Composable
private fun AgentDetailContent(
    agent: Agent,
    state: AgentDetailUiState,
    isIdentityMutating: Boolean,
    onEdit: () -> Unit,
    onAddSkill: () -> Unit,
    onToggleSkill: (AgentSkillLink, Boolean) -> Unit,
    onRemoveSkill: (AgentSkillLink) -> Unit,
    onForgetMemory: (AgentMemoryRecord) -> Unit,
    onCorrectMemory: (AgentMemoryRecord) -> Unit,
    portraitViewModel: UserPortraitViewModel,
    onOpenChatSession: (String, String, String, String) -> Unit,
    onRetry: () -> Unit,
    onDeactivate: () -> Unit,
) {
    val cardInset = Modifier.padding(horizontal = TTSpacing.lg)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = TTSpacing.lg, bottom = TTSpacing.xxxl),
        verticalArrangement = Arrangement.spacedBy(TTSpacing.lg),
    ) {
        item {
            IdentityCard(
                agent = agent,
                enabled = !isIdentityMutating,
                onEdit = onEdit,
                modifier = cardInset,
            )
        }
        item {
            PersonaCard(
                agent = agent,
                enabled = !isIdentityMutating,
                onEdit = onEdit,
                modifier = cardInset,
            )
        }
        item {
            SkillsCard(
                skills = state.skills,
                loading = state.isLoading,
                mutatingKeys = state.mutatingSkillKeys,
                canAdd = agent.organizationId.isNotBlank(),
                onAddSkill = onAddSkill,
                onToggleSkill = onToggleSkill,
                onRemoveSkill = onRemoveSkill,
                modifier = cardInset,
            )
        }
        item {
            MemoryCard(
                agent = agent,
                portraitViewModel = portraitViewModel,
                modifier = cardInset,
            )
        }
        item {
            MemoryRecordsCard(
                memories = state.memories,
                loading = state.isLoading,
                forgettingIds = state.forgettingMemoryIds,
                correctingIds = state.correctingMemoryIds,
                onForget = onForgetMemory,
                onCorrect = onCorrectMemory,
                modifier = cardInset,
            )
        }
        item {
            RecentTasksCard(
                sessions = state.sessions,
                tasks = state.projectTasks,
                loading = state.isLoading,
                fallbackOrganizationId = agent.organizationId,
                onOpenChatSession = onOpenChatSession,
                modifier = cardInset,
            )
        }
        item {
            ToolsCard(
                connections = state.mcpConnections,
                loading = state.isLoading,
                deviceOffline = state.mcpDeviceOffline,
                loadErrorRes = state.mcpLoadErrorRes,
                onRetry = onRetry,
                modifier = cardInset,
            )
        }
        if (agent.isDefault != true) {
            item {
                DetailCard(modifier = cardInset) {
                    TextButton(
                        onClick = onDeactivate,
                        enabled = !isIdentityMutating,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) {
                        Icon(Icons.Default.RemoveCircleOutline, contentDescription = null)
                        Spacer(Modifier.width(TTSpacing.xs))
                        Text(
                            text = stringResource(R.string.my_agents_deactivate),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }
    }
}

/** 身份证：沿用原来的竖排，只是收进一张抬起的圆角卡。 */
@Composable
private fun IdentityCard(
    agent: Agent,
    enabled: Boolean,
    onEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = TTRadius.Shapes.xl,
        color = agentPlateColor(),
        shadowElevation = if (LocalTTDarkTheme.current) 0.dp else 2.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(TTSpacing.xl),
        ) {
            AgentIdentityAvatar(
                name = agent.detailName(),
                avatarKey = agent.settings?.avatarKey,
                avatarUrl = agent.settings?.avatarUrl,
                size = 60.dp,
            )
            Spacer(Modifier.height(TTSpacing.md))
            Text(
                text = agent.detailName(),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = ttColor(TTColors.TextOnPrimary, TTColors.Dark.TextOnPrimary),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(TTSpacing.xs))
            Text(
                text = agentPlateMeta(agent),
                style = MaterialTheme.typography.bodySmall,
                color = ttColor(TTColors.TextOnPrimary, TTColors.Dark.TextOnPrimary).copy(alpha = 0.78f),
            )
            Spacer(Modifier.height(TTSpacing.xl))
            Button(
                onClick = onEdit,
                enabled = enabled,
                shape = RoundedCornerShape(TTRadius.full),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ttColor(TTColors.TextOnPrimary, TTColors.Dark.TextOnPrimary),
                    contentColor = ttColor(TTColors.Primary, TTColors.Dark.Primary),
                ),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(TTSpacing.xs))
                Text(stringResource(R.string.my_agents_edit))
            }
        }
    }
}

@Composable
private fun agentPlateMeta(agent: Agent): String {
    val source = stringResource(
        if (agent.templateId.isNullOrBlank()) {
            R.string.my_agents_source_custom
        } else {
            R.string.my_agents_source_template
        },
    )
    val defaultLabel = stringResource(R.string.my_agents_default)
    val updated = RelativeTimeFormatter.format(LocalContext.current, agent.updatedAt)
        ?.let { stringResource(R.string.my_agents_updated_at, it) }
    return listOfNotNull(
        source,
        defaultLabel.takeIf { agent.isDefault == true },
        updated,
    ).joinToString(" · ")
}

@Composable
private fun PersonaCard(
    agent: Agent,
    enabled: Boolean,
    onEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    DetailCard(
        modifier = modifier,
        footnote = stringResource(R.string.my_agents_persona_scope_hint),
    ) {
        CardHeader(stringResource(R.string.my_agents_persona_rules))
        Text(
            text = agent.customRules.ifBlank { stringResource(R.string.my_agents_detail_rules_empty) },
            style = MaterialTheme.typography.bodyMedium,
            color = if (agent.customRules.isBlank()) {
                ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary)
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = enabled, onClick = onEdit)
                .padding(
                    start = TTSpacing.lg,
                    end = TTSpacing.lg,
                    top = TTSpacing.xs,
                    bottom = TTSpacing.lg,
                ),
        )
    }
}

/** 工具携带集：问在线 Electron 的已挂载 MCP（只读列表，挂载请在电脑端管理）。 */
@Composable
private fun ToolsCard(
    connections: List<AgentLocalMcpAttachment>,
    loading: Boolean,
    deviceOffline: Boolean,
    @androidx.annotation.StringRes loadErrorRes: Int?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    DetailCard(
        modifier = modifier,
        footnote = stringResource(R.string.my_agents_tools_hint),
    ) {
        CardHeader(
            title = stringResource(R.string.my_agents_tools),
            count = connections.size.takeIf { it > 0 },
        )
        when {
            deviceOffline -> CardNote(
                text = stringResource(R.string.my_agents_tools_device_offline),
                tint = ttColor(TTColors.TextWarning, TTColors.Dark.TextWarning),
                onRetry = onRetry,
            )
            loadErrorRes != null -> CardNote(
                text = stringResource(loadErrorRes),
                tint = ttColor(TTColors.TextWarning, TTColors.Dark.TextWarning),
                onRetry = onRetry,
            )
            loading && connections.isEmpty() -> CardLoading()
            connections.isEmpty() -> CardEmpty(stringResource(R.string.my_agents_tools_not_mounted))
            else -> CardRows(connections.size) { index ->
                McpConnectionRow(connection = connections[index])
            }
        }
    }
}

@Composable
private fun McpConnectionRow(connection: AgentLocalMcpAttachment) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = TTSpacing.lg, vertical = TTSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ConnectorBrandGlyph(
            query = ConnectorBrandIconResolver.Query(
                name = connection.name,
                endpointUrl = connection.endpointForBrand,
            ),
            size = 28.dp,
            cornerRadius = 6.dp,
            padded = true,
        )
        Spacer(Modifier.width(TTSpacing.md))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = connection.name.ifBlank { connection.id },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            connection.description.takeIf { it.isNotBlank() }?.let { description ->
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(TTSpacing.sm))
        CardTag(
            stringResource(
                when (connection.sourceKind) {
                    OrgMcpSourceKind.LOCAL -> R.string.my_agents_tools_source_local
                    OrgMcpSourceKind.ORGANIZATION -> R.string.my_agents_tools_source_org
                },
            ),
        )
    }
}

@Composable
private fun SkillsCard(
    skills: List<AgentSkillLink>,
    loading: Boolean,
    mutatingKeys: Set<String>,
    canAdd: Boolean,
    onAddSkill: () -> Unit,
    onToggleSkill: (AgentSkillLink, Boolean) -> Unit,
    onRemoveSkill: (AgentSkillLink) -> Unit,
    modifier: Modifier = Modifier,
) {
    DetailCard(
        modifier = modifier,
        footnote = stringResource(R.string.my_agents_skills_hint),
    ) {
        CardHeader(
            title = stringResource(R.string.my_agents_skills),
            count = skills.size.takeIf { it > 0 },
            actionTitle = stringResource(R.string.my_agents_add_skill),
            actionEnabled = canAdd,
            onAction = onAddSkill,
        )
        when {
            loading && skills.isEmpty() -> CardLoading()
            skills.isEmpty() -> CardEmpty(stringResource(R.string.my_agents_skills_empty))
            else -> CardRows(skills.size) { index ->
                val skill = skills[index]
                SkillRow(
                    skill = skill,
                    mutating = skill.skillCanonicalKey in mutatingKeys,
                    onToggle = { onToggleSkill(skill, it) },
                    onRemove = { onRemoveSkill(skill) },
                )
            }
        }
    }
}

@Composable
private fun SkillRow(
    skill: AgentSkillLink,
    mutating: Boolean,
    onToggle: (Boolean) -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = TTSpacing.lg, vertical = TTSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(R.drawable.lucide_book_text),
            contentDescription = null,
            tint = ttColor(TTColors.Primary, TTColors.Dark.Primary),
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.width(TTSpacing.md))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                skill.name.ifBlank { skill.skillCanonicalKey },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            skill.description?.takeIf { it.isNotBlank() }?.let { description ->
                Text(
                    description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (skill.locked) {
                Text(
                    stringResource(R.string.my_agents_skill_locked),
                    style = MaterialTheme.typography.labelSmall,
                    color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
                )
            }
        }
        // 锁定项不摆按不动的开关和移除按钮，右侧留空。
        if (!skill.locked) {
            Switch(
                checked = skill.enabled,
                onCheckedChange = onToggle,
                enabled = !mutating,
            )
            IconButton(onClick = onRemove, enabled = !mutating) {
                Icon(
                    Icons.Default.RemoveCircleOutline,
                    contentDescription = stringResource(R.string.my_agents_remove_skill),
                    tint = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentSkillPickerSheet(
    candidates: List<VisibleSkillEntry>,
    attachedKeys: Set<String>,
    loading: Boolean,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onAttachSelected: (List<VisibleSkillEntry>) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var selectedKeys by remember { mutableStateOf(setOf<String>()) }
    val available = remember(candidates, attachedKeys, query) {
        AgentSkillPickerFilter.available(candidates, attachedKeys, query)
    }
    // 已携带项从列表消失后，清掉过期勾选，避免底部计数虚高。
    LaunchedEffect(attachedKeys) {
        selectedKeys = selectedKeys - attachedKeys
    }
    val selectedSkills = remember(available, selectedKeys) {
        available.filter { it.canonicalKey in selectedKeys }
    }
    TTBottomSheet(onDismissRequest = onDismiss) {
        TTSheetColumn(
            scrollable = false,
            modifier = Modifier
                .padding(horizontal = TTSpacing.xl)
                .padding(bottom = TTSpacing.lg),
        ) {
            Text(
                text = stringResource(R.string.my_agents_add_skill_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.height(TTSpacing.sm))
            TabSearchField(
                query = query,
                onQueryChange = { query = it },
                placeholder = stringResource(R.string.my_agents_add_skill_search),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(TTSpacing.sm))
            when {
                loading && candidates.isEmpty() -> Box(
                    modifier = Modifier.fillMaxWidth().height(120.dp),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }
                available.isEmpty() -> Text(
                    text = stringResource(R.string.my_agents_add_skill_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = TTSpacing.lg),
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxWidth().height(360.dp),
                    verticalArrangement = Arrangement.spacedBy(TTSpacing.xs),
                ) {
                    items(available, key = { it.canonicalKey }) { skill ->
                        val checked = skill.canonicalKey in selectedKeys
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !submitting) {
                                    selectedKeys = if (checked) {
                                        selectedKeys - skill.canonicalKey
                                    } else {
                                        selectedKeys + skill.canonicalKey
                                    }
                                }
                                .padding(vertical = TTSpacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = checked,
                                onCheckedChange = { enabled ->
                                    selectedKeys = if (enabled) {
                                        selectedKeys + skill.canonicalKey
                                    } else {
                                        selectedKeys - skill.canonicalKey
                                    }
                                },
                                enabled = !submitting,
                            )
                            Spacer(modifier = Modifier.width(TTSpacing.xs))
                            Icon(
                                painter = painterResource(R.drawable.lucide_book_text),
                                contentDescription = null,
                                tint = ttColor(TTColors.Primary, TTColors.Dark.Primary),
                                modifier = Modifier.size(24.dp),
                            )
                            Spacer(modifier = Modifier.width(TTSpacing.sm))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    skill.resolvedName,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                )
                                skill.description.takeIf { it.isNotBlank() }?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(TTSpacing.md))
            Button(
                onClick = { onAttachSelected(selectedSkills) },
                enabled = selectedSkills.isNotEmpty() && !submitting,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (submitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(modifier = Modifier.width(TTSpacing.sm))
                }
                Text(
                    text = if (selectedSkills.size <= 1) {
                        stringResource(R.string.my_agents_add_skill_action)
                    } else {
                        stringResource(R.string.my_agents_add_skill_action_count, selectedSkills.size)
                    },
                )
            }
        }
    }
}

/** 记忆概览：TA 对你的综合理解。 */
@Composable
private fun MemoryCard(
    agent: Agent,
    portraitViewModel: UserPortraitViewModel,
    modifier: Modifier = Modifier,
) {
    DetailCard(
        modifier = modifier,
        footnote = stringResource(R.string.my_agents_memory_overview_hint),
    ) {
        CardHeader(stringResource(R.string.my_agents_memory))
        UserPortraitPanel(
            organizationId = agent.organizationId,
            agentId = agent.id,
            organizationName = null,
            canManage = true,
            viewModel = portraitViewModel,
            modifier = Modifier.padding(
                start = TTSpacing.lg,
                end = TTSpacing.lg,
                top = TTSpacing.xs,
                bottom = TTSpacing.lg,
            ),
        )
    }
}

@Composable
private fun MemoryRecordsCard(
    memories: List<AgentMemoryRecord>,
    loading: Boolean,
    forgettingIds: Set<String>,
    correctingIds: Set<String>,
    onForget: (AgentMemoryRecord) -> Unit,
    onCorrect: (AgentMemoryRecord) -> Unit,
    modifier: Modifier = Modifier,
) {
    DetailCard(
        modifier = modifier,
        footnote = stringResource(R.string.my_agents_memory_records_hint),
    ) {
        CardHeader(
            title = stringResource(R.string.my_agents_memory_records),
            count = memories.size.takeIf { it > 0 },
        )
        when {
            loading && memories.isEmpty() -> CardLoading()
            memories.isEmpty() -> CardEmpty(stringResource(R.string.my_agents_memory_empty))
            else -> CardRows(memories.size) { index ->
                val memory = memories[index]
                MemoryRow(
                    memory = memory,
                    busy = memory.id in forgettingIds || memory.id in correctingIds,
                    onForget = onForget,
                    onCorrect = onCorrect,
                )
            }
        }
    }
}

@Composable
private fun MemoryRow(
    memory: AgentMemoryRecord,
    busy: Boolean,
    onForget: (AgentMemoryRecord) -> Unit,
    onCorrect: (AgentMemoryRecord) -> Unit,
) {
    var menuOpen by remember(memory.id) { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = TTSpacing.lg, end = TTSpacing.sm, top = TTSpacing.sm, bottom = TTSpacing.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val normalizedTitle = memory.title.trim()
            Text(
                text = if (shouldUseAgentMemoryTypeLabel(memory.memoryType, normalizedTitle)) {
                    stringResource(agentMemoryTypeLabelRes(memory.memoryType))
                } else {
                    normalizedTitle
                },
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // 纠正 / 忘记收进一个菜单，行里只留一个控件。
            Box {
                IconButton(onClick = { menuOpen = true }, enabled = !busy) {
                    Icon(
                        Icons.Default.MoreHoriz,
                        contentDescription = stringResource(R.string.my_agents_memory),
                        tint = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
                    )
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.my_agents_correct_memory)) },
                        onClick = {
                            menuOpen = false
                            onCorrect(memory)
                        },
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = stringResource(R.string.my_agents_forget_memory),
                                color = MaterialTheme.colorScheme.error,
                            )
                        },
                        onClick = {
                            menuOpen = false
                            onForget(memory)
                        },
                    )
                }
            }
        }
        Text(
            text = memory.content,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        if (memory.tags.isNotEmpty()) {
            Spacer(Modifier.height(TTSpacing.xxs))
            Text(
                text = memory.tags.take(3).joinToString("  ") { "#$it" },
                style = MaterialTheme.typography.labelSmall,
                color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun MemoryCorrectDialog(
    memory: AgentMemoryRecord,
    isSaving: Boolean,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var draft by remember(memory.id) { mutableStateOf(memory.content) }
    val trimmed = draft.trim()
    AlertDialog(
        onDismissRequest = {
            if (!isSaving) onDismiss()
        },
        title = { Text(stringResource(R.string.my_agents_correct_memory_title)) },
        text = {
            Column {
                Text(
                    text = stringResource(R.string.my_agents_correct_memory_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(TTSpacing.sm))
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    enabled = !isSaving,
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 6,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(trimmed) },
                enabled = !isSaving && trimmed.isNotBlank() && trimmed != memory.content,
            ) {
                Text(stringResource(R.string.common_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isSaving) {
                Text(stringResource(R.string.common_cancel))
            }
        },
    )
}

@Composable
private fun RecentTasksCard(
    sessions: List<AllChatSession>,
    tasks: List<AgentProjectTask>,
    loading: Boolean,
    fallbackOrganizationId: String,
    onOpenChatSession: (String, String, String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = remember(sessions, tasks) { agentActivityItems(sessions, tasks) }
    DetailCard(
        modifier = modifier,
        footnote = stringResource(R.string.my_agents_recent_tasks_hint),
    ) {
        CardHeader(
            title = stringResource(R.string.my_agents_recent_tasks),
            count = items.size.takeIf { it > 0 },
        )
        when {
            loading && items.isEmpty() -> CardLoading()
            items.isEmpty() -> CardEmpty(stringResource(R.string.my_agents_recent_tasks_empty))
            else -> CardRows(items.size) { index ->
                when (val item = items[index]) {
                    is AgentActivityItem.Session -> SessionActivityRow(
                        session = item.session,
                        fallbackOrganizationId = fallbackOrganizationId,
                        onOpenChatSession = onOpenChatSession,
                    )
                    is AgentActivityItem.Task -> TaskActivityRow(item.task)
                }
            }
        }
    }
}

@Composable
private fun SessionActivityRow(
    session: AllChatSession,
    fallbackOrganizationId: String,
    onOpenChatSession: (String, String, String, String) -> Unit,
) {
    val executionSpaceId = if (!session.projectId.isNullOrBlank()) session.workspaceId else session.spaceId
    val kind = stringResource(R.string.my_agents_chat)
    val time = (session.lastMessageAt ?: session.updatedAt ?: session.createdAt)?.let {
        RelativeTimeFormatter.format(LocalContext.current, it)
    }
    ActivityRow(
        title = session.displayTitle.ifBlank { kind },
        subtitle = activitySubtitle(kind, session.spaceName ?: session.projectName),
        time = time,
        modifier = if (!executionSpaceId.isNullOrBlank()) {
            Modifier.clickable {
                onOpenChatSession(
                    session.id,
                    executionSpaceId,
                    session.spaceName ?: session.projectName.orEmpty(),
                    session.organizationId ?: fallbackOrganizationId,
                )
            }
        } else Modifier,
    )
}

@Composable
private fun TaskActivityRow(task: AgentProjectTask) {
    val context = LocalContext.current
    ActivityRow(
        title = task.title,
        subtitle = activitySubtitle(
            kind = stringResource(R.string.my_agents_project_task),
            scope = task.project?.name ?: task.workStatus ?: task.assignmentStatus,
        ),
        time = task.updatedAt?.let { RelativeTimeFormatter.format(context, it) },
    )
}

/** Chat 会话和 Project 任务混在一张列表里，类型必须写进副标题——行里没有图标区分。 */
private fun activitySubtitle(kind: String, scope: String?): String {
    val trimmed = scope?.trim()
    return if (trimmed.isNullOrEmpty()) kind else "$kind · $trimmed"
}

/** 任务行不放前置图标：类型已经写在副标题里，图标只会把标题挤窄。 */
@Composable
private fun ActivityRow(
    title: String,
    subtitle: String,
    time: String?,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = TTSpacing.lg, vertical = TTSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        time?.let {
            Spacer(Modifier.width(TTSpacing.md))
            Text(
                text = it,
                style = MaterialTheme.typography.labelSmall,
                color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
            )
        }
    }
}

// region 卡片零件

/** 页底压深一档、卡片抬亮一档，卡片才浮得起来。 */
@Composable
private fun agentPageColor(): Color = ttColor(TTColors.BgSubtle, TTColors.Dark.Background)

@Composable
private fun agentCardColor(): Color = ttColor(TTColors.Background, TTColors.Dark.SurfaceVariant)

/** 身份证铺当前 scheme 的强调色，不再用白底。 */
@Composable
private fun agentPlateColor(): Color = ttColor(TTColors.Primary, TTColors.Dark.Primary)

@Composable
private fun DetailCard(
    modifier: Modifier = Modifier,
    footnote: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = TTRadius.Shapes.xl,
            color = agentCardColor(),
            // 深色底上投影看不见，只在浅色抬卡片。
            shadowElevation = if (LocalTTDarkTheme.current) 0.dp else 2.dp,
        ) {
            Column(content = content)
        }
        if (footnote != null) {
            Text(
                text = footnote,
                style = MaterialTheme.typography.bodySmall,
                color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
                modifier = Modifier.padding(
                    start = TTSpacing.xs,
                    end = TTSpacing.xs,
                    top = TTSpacing.sm,
                ),
            )
        }
    }
}

/** 区标题：一根强调色短标 + 标题 + 计数，右侧可挂一个文字动作。 */
@Composable
private fun CardHeader(
    title: String,
    count: Int? = null,
    actionTitle: String? = null,
    actionEnabled: Boolean = true,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = TTSpacing.lg,
                end = TTSpacing.sm,
                top = TTSpacing.md,
                bottom = TTSpacing.xs,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(width = 3.dp, height = 13.dp)
                .background(
                    color = ttColor(TTColors.Primary, TTColors.Dark.Primary),
                    shape = RoundedCornerShape(TTSpacing.xxs),
                ),
        )
        Spacer(Modifier.width(TTSpacing.sm))
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if (count != null) {
            Spacer(Modifier.width(TTSpacing.sm))
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.labelMedium,
                color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
            )
        }
        Spacer(Modifier.weight(1f))
        if (actionTitle != null && onAction != null) {
            TextButton(onClick = onAction, enabled = actionEnabled) { Text(actionTitle) }
        }
    }
}

@Composable
private fun CardRows(count: Int, row: @Composable (Int) -> Unit) {
    Column(modifier = Modifier.padding(bottom = TTSpacing.sm)) {
        repeat(count) { index ->
            row(index)
            if (index < count - 1) {
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = TTSpacing.lg),
                    color = ttColor(TTColors.BorderLight, TTColors.Dark.BorderLight),
                )
            }
        }
    }
}

@Composable
private fun CardEmpty(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.bodySmall,
        color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
        modifier = Modifier.padding(
            start = TTSpacing.lg,
            end = TTSpacing.lg,
            top = TTSpacing.xs,
            bottom = TTSpacing.lg,
        ),
    )
}

@Composable
private fun CardLoading() {
    Box(
        modifier = Modifier.padding(
            start = TTSpacing.lg,
            end = TTSpacing.lg,
            top = TTSpacing.xs,
            bottom = TTSpacing.lg,
        ),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
    }
}

/** 卡内的一段说明，可带重试（工具携带集读不到电脑端时用）。 */
@Composable
private fun CardNote(text: String, tint: Color, onRetry: (() -> Unit)? = null) {
    Column(
        modifier = Modifier.padding(
            start = TTSpacing.lg,
            end = TTSpacing.lg,
            top = TTSpacing.xs,
            bottom = TTSpacing.md,
        ),
    ) {
        Text(text = text, style = MaterialTheme.typography.bodyMedium, color = tint)
        if (onRetry != null) {
            Spacer(Modifier.height(TTSpacing.xs))
            TextButton(
                onClick = onRetry,
                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
            ) {
                Text(stringResource(R.string.common_retry))
            }
        }
    }
}

@Composable
private fun CardTag(title: String) {
    Surface(
        shape = RoundedCornerShape(TTRadius.full),
        color = ttColor(TTColors.BgSubtle, TTColors.Dark.BgSubtle),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelSmall,
            color = ttColor(TTColors.TextTertiary, TTColors.Dark.TextTertiary),
            modifier = Modifier.padding(horizontal = TTSpacing.sm, vertical = 3.dp),
        )
    }
}

// endregion

private fun Agent.detailName(): String = displayName?.trim()?.takeIf { it.isNotEmpty() } ?: name
