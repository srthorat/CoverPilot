import { NextRequest, NextResponse } from 'next/server';
import { SCENARIOS } from '@/lib/scenarios';
import { metaModelClient } from '@/lib/meta-client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { scenarioId, userPrompt, currentState, modelOverride } = body;

    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) {
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }

    const steps = await metaModelClient.runAgentSession(
      {
        scenarioId,
        userPrompt: userPrompt || scenario.samplePrompts[0],
        currentState: currentState || scenario.initialState,
        modelOverride,
      },
      scenario
    );

    return NextResponse.json({
      success: true,
      isLiveMetaApi: metaModelClient.isLive(),
      steps,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to execute agent reasoning' },
      { status: 500 }
    );
  }
}
