import { Match, Switch } from "solid-js"
import { useRouteData } from "../context/route"
import { OnboardingWelcome } from "./onboarding/welcome"
import { OnboardingTheme } from "./onboarding/theme"
import { OnboardingProvider } from "./onboarding/provider"
import { OnboardingAgents } from "./onboarding/agents"
import { OnboardingCommands } from "./onboarding/commands"
import { OnboardingComplete } from "./onboarding/complete"

export function Onboarding() {
  const route = useRouteData("onboarding")

  return (
    <Switch>
      <Match when={route.step === "welcome"}>
        <OnboardingWelcome />
      </Match>
      <Match when={route.step === "theme"}>
        <OnboardingTheme />
      </Match>
      <Match when={route.step === "provider"}>
        <OnboardingProvider />
      </Match>
      <Match when={route.step === "agents"}>
        <OnboardingAgents />
      </Match>
      <Match when={route.step === "commands"}>
        <OnboardingCommands />
      </Match>
      <Match when={route.step === "complete"}>
        <OnboardingComplete />
      </Match>
    </Switch>
  )
}
