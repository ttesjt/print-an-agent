declare const toolNameBrand: unique symbol;

declare const toolCallIdBrand: unique symbol;

export type ToolName = string & { readonly [toolNameBrand]: 'ToolName' };

export type ToolCallId = string & { readonly [toolCallIdBrand]: 'ToolCallId' };
