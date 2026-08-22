package com.tabtin.mobile.data.repository

import android.content.Context
import com.tabtin.mobile.data.model.isPersistablePreferredModelId
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** 本机上次选用的运行时模型，对齐 Electron `tabtin:agent-runtime-model:`。 */
@Singleton
public class AgentRuntimeModelPreferenceStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    public fun read(agentId: String?): String? {
        val normalizedAgent = agentId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return prefs.getString(KEY_PREFIX + normalizedAgent, null)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
    }

    public fun write(agentId: String?, modelId: String) {
        val normalizedAgent = agentId?.trim()?.takeIf { it.isNotEmpty() } ?: return
        val normalizedModel = modelId.trim()
        if (!isPersistablePreferredModelId(normalizedModel)) return
        prefs.edit().putString(KEY_PREFIX + normalizedAgent, normalizedModel).apply()
    }

    private companion object {
        const val PREFS_NAME = "agent_runtime_model_preferences"
        const val KEY_PREFIX = "tabtin:agent-runtime-model:"
    }
}
