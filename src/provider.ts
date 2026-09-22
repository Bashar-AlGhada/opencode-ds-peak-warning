export type SelectedModel = {
  readonly providerID?: string
  readonly modelID?: string
}

export function isDeepSeekModel(model: SelectedModel | undefined): boolean {
  if (!model) return false
  return `${model.providerID ?? ""}/${model.modelID ?? ""}`.toLowerCase().includes("deepseek")
}
