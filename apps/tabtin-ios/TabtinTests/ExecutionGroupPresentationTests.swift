import XCTest
@testable import Tabtin

/// 执行组的**呈现口径**测试：时间线只展示执行组一行，详情走抽屉。
/// 断言的是「谁算一步 / 组行怎么说 / 抽屉里先展开谁」，不涉及 SwiftUI 渲染。
final class ExecutionGroupPresentationTests: XCTestCase {
    private func thinking(
        index: Int,
        completed: Bool,
        text: String = "分析中"
    ) -> MessageBlock {
        .thinking(ThinkingSegment(
            messageId: "m1",
            index: index,
            text: text,
            completed: completed
        ))
    }

    private func tool(
        id: String,
        index: Int,
        name: String = "bash",
        phase: ToolExecutionPhase = .succeeded,
        isError: Bool = false,
        suspicious: Bool = false
    ) -> MessageBlock {
        var call = ToolCall(
            toolCallId: id,
            index: index,
            name: name,
            inputJson: #"{"command":"swift build"}"#,
            finalized: true,
            isError: isError,
            executionPhase: phase
        )
        call.hasSuspiciousOutput = suspicious
        return .tool(call)
    }

    // MARK: - 谁算一步

    func testExecutionStepCoversThinkingAndOrdinaryToolsButNotSubagentDispatch() {
        XCTAssertTrue(ExecutionStepPresentation.isExecutionStep(thinking(index: 0, completed: true)))
        XCTAssertTrue(ExecutionStepPresentation.isExecutionStep(tool(id: "t1", index: 1)))
        XCTAssertFalse(
            ExecutionStepPresentation.isExecutionStep(tool(id: "t2", index: 2, name: "task"))
        )
        XCTAssertFalse(
            ExecutionStepPresentation.isExecutionStep(.text(TextBlock(index: 3, text: "结论")))
        )
    }

    /// 分组口径必须与组行 / 抽屉共用同一份，否则「时间线算一步、抽屉不算」会漂移。
    func testTimelineGroupingUsesSameStepDefinition() {
        let blocks = [
            thinking(index: 0, completed: true),
            tool(id: "t1", index: 1),
            .text(TextBlock(index: 2, text: "小结")),
            tool(id: "t2", index: 3, name: "task"),
        ]

        let units = AssistantTimelineUnit.group(blocks)
        guard case let .stepGroup(group) = units.first else {
            return XCTFail("思考 + 工具应收成执行组")
        }
        XCTAssertEqual(group.count, 2)
        guard case .single = units[1], case .single = units[2] else {
            return XCTFail("正文与子 Agent 派发不进执行组")
        }
    }

    /// 文生图是 DiffCard 级交付物，绝不进执行步骤抽屉。
    func testMediaImageGenerationIsNotExecutionStep() {
        let call = ToolCall(
            toolCallId: "img1",
            index: 1,
            name: "run_terminal_command",
            inputJson: #"{"command":"tabtin media image generate --prompt x"}"#,
            finalized: true,
            resultText: #"{"result_urls":["https://example.com/a.png"]}"#,
            executionPhase: .succeeded,
            presentationKind: "media_image_generation",
            presentationPrompt: "红苹果"
        )
        XCTAssertFalse(ExecutionStepPresentation.isExecutionStep(.tool(call)))
    }

    /// 生图打断折叠段：前后步骤各自成组，生图永远 `.single`。
    func testMediaImageBreaksExecutionGroup() {
        let img = ToolCall(
            toolCallId: "img1",
            index: 2,
            name: "run_terminal_command",
            inputJson: "{}",
            finalized: true,
            presentationKind: "media_image_generation"
        )
        let blocks: [MessageBlock] = [
            thinking(index: 0, completed: true),
            tool(id: "t1", index: 1),
            .tool(img),
            tool(id: "t2", index: 3),
            tool(id: "t3", index: 4),
        ]
        let units = AssistantTimelineUnit.group(blocks)

        XCTAssertEqual(units.count, 3)
        guard case let .stepGroup(before) = units[0] else {
            return XCTFail("生图前连续步骤应收成执行组")
        }
        XCTAssertEqual(before.count, 2)
        guard case let .single(mediaBlock) = units[1],
              case let .tool(mediaTool) = mediaBlock else {
            return XCTFail("生图必须是 .single，打断折叠段")
        }
        XCTAssertTrue(mediaTool.isMediaImageGeneration)
        guard case let .stepGroup(after) = units[2] else {
            return XCTFail("生图后连续步骤应另成执行组")
        }
        XCTAssertEqual(after.count, 2)
    }

    /// 移动端两步就该收组——竖屏放不下连续步骤。
    func testTwoConsecutiveStepsCollapseIntoGroup() {
        let units = AssistantTimelineUnit.group([
            tool(id: "t1", index: 0),
            tool(id: "t2", index: 1),
        ])

        XCTAssertEqual(units.count, 1)
        guard case let .stepGroup(group) = units.first else {
            return XCTFail("连续两步应收成执行组")
        }
        XCTAssertEqual(group.count, 2)
    }

    /// 单步不成组：「读取 Package.swift」比「执行详情 · 1 步」信息量更高。
    func testSingleStepStaysAsPlainRow() {
        let units = AssistantTimelineUnit.group([tool(id: "t1", index: 0)])

        XCTAssertEqual(units.count, 1)
        guard case .single = units.first else {
            return XCTFail("单步应保持原始行，不套执行组")
        }
    }

    // MARK: - 组行摘要

    /// 组头对失败无感——对齐 Electron `CollapsibleToolCardGroup`（只有图标 + 文案 + 步数）。
    /// 失败不该在阅读流里被计数、被染红，原因交给 Agent 正文。
    func testSummaryDoesNotAggregateFailures() {
        let summary = ExecutionGroupSummary(blocks: [
            thinking(index: 0, completed: true),
            tool(id: "t1", index: 1),
            tool(id: "t2", index: 2, phase: .failed, isError: true),
        ])

        XCTAssertEqual(summary.stepCount, 3)
        XCTAssertEqual(summary.runningCount, 0)
        XCTAssertFalse(summary.hasSuspicious)
        XCTAssertFalse(
            summary.accessibilityLabel.contains("失败"),
            "组行无障碍播报也不能提失败"
        )
    }

    /// 成功态不留「已完成」噪声。
    func testSummaryStaysQuietWhenEverythingSucceeded() {
        let summary = ExecutionGroupSummary(blocks: [
            tool(id: "t1", index: 0),
            tool(id: "t2", index: 1),
        ])

        XCTAssertNil(summary.activeTailId)
        XCTAssertFalse(summary.isRunning)
    }

    /// 尾步在跑就必须留在时间线上实时可见，否则运行中界面看起来像卡死。
    func testRunningTailStepIsExposed() {
        let blocks = [
            tool(id: "t1", index: 0),
            thinking(index: 1, completed: false),
        ]
        let summary = ExecutionGroupSummary(blocks: blocks)

        XCTAssertTrue(summary.isRunning)
        XCTAssertEqual(summary.activeTailId, blocks[1].id)
    }

    /// 只认末尾那一步：中间步骤结果滞后不应把整组打散。
    func testOnlyTrailingStepCountsAsActiveTail() {
        let summary = ExecutionGroupSummary(blocks: [
            tool(id: "t1", index: 0, phase: .running),
            tool(id: "t2", index: 1, phase: .succeeded),
        ])

        XCTAssertTrue(summary.isRunning)
        XCTAssertNil(summary.activeTailId, "非末尾的运行中步骤不外露，整组照常收起")
    }

    func testSuspiciousOutputSurfacesOnGroupRow() {
        let summary = ExecutionGroupSummary(blocks: [
            tool(id: "t1", index: 0),
            tool(id: "t2", index: 1, suspicious: true),
        ])

        XCTAssertTrue(summary.hasSuspicious)
    }

    // MARK: - 抽屉展开策略

    /// 单步抽屉（从时间线单行点进来）直接铺开，不再让用户多点一次。
    func testSoleStepAlwaysExpandsInSheet() {
        XCTAssertTrue(
            ExecutionStepDetailExpansion.initialExpanded(
                for: tool(id: "t1", index: 0),
                isSoleStep: true
            )
        )
    }

    /// 多步时只展开需要看的：运行中 / 安全护栏命中；其余折叠，避免整段倾泻。
    /// 失败步刻意保持折叠——对齐 Electron，别一打开抽屉就把失败原文推到用户脸上。
    func testMultiStepSheetExpandsOnlyNoteworthySteps() {
        XCTAssertFalse(
            ExecutionStepDetailExpansion.initialExpanded(
                for: tool(id: "t1", index: 0),
                isSoleStep: false
            )
        )
        XCTAssertTrue(
            ExecutionStepDetailExpansion.initialExpanded(
                for: tool(id: "t2", index: 1, phase: .running),
                isSoleStep: false
            )
        )
        XCTAssertFalse(
            ExecutionStepDetailExpansion.initialExpanded(
                for: tool(id: "t3", index: 2, phase: .failed, isError: true),
                isSoleStep: false
            ),
            "失败步默认折叠"
        )
        XCTAssertTrue(
            ExecutionStepDetailExpansion.initialExpanded(
                for: tool(id: "t4", index: 3, suspicious: true),
                isSoleStep: false
            )
        )
    }

    /// 打开抽屉只落到正在跑的那一步；失败不抢焦点。
    func testSheetFocusPrefersRunningAndIgnoresFailure() {
        let failing = tool(id: "t2", index: 1, phase: .failed, isError: true)
        let running = tool(id: "t3", index: 2, phase: .running)

        XCTAssertEqual(
            ExecutionStepDetailExpansion.focusTargetId(
                in: [tool(id: "t1", index: 0), failing, running]
            ),
            running.id
        )
        XCTAssertNil(
            ExecutionStepDetailExpansion.focusTargetId(in: [tool(id: "t1", index: 0), failing]),
            "只有失败步时从头读，不跳到失败上"
        )
    }

    // MARK: - 步骤文案

    /// 步骤行、抽屉标题共用同一份文案，避免两处各自拼接后漂移。
    func testStepLabelReusesThinkingAndToolVocabulary() {
        let thinkingBlock = thinking(index: 0, completed: false)
        XCTAssertEqual(
            ExecutionStepPresentation.label(for: thinkingBlock),
            ThinkingStepPresentation.label(for: .streaming)
        )
        XCTAssertEqual(ExecutionStepPresentation.iconName(for: thinkingBlock), "Brain")

        var call = ToolCall(
            toolCallId: "t1",
            index: 1,
            name: "run_terminal_command",
            inputJson: #"{"description":"生成 Word 文档"}"#,
            finalized: true
        )
        call.executionPhase = .succeeded
        XCTAssertEqual(ExecutionStepPresentation.label(for: .tool(call)), "生成 Word 文档")
        XCTAssertEqual(ExecutionStepPresentation.iconName(for: .tool(call)), "Terminal")
    }
}
