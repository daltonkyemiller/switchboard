local M = {}

---@class SwitchboardCommandsConfig
---@field command? string Switchboard CLI executable or absolute path.
---@field submit? boolean Submit sent text with Enter. Defaults to true.
---@field select_agent? boolean Open the agent selector before sending. Defaults to false.

---@class SwitchboardSendSelectionOptions
---@field command? string Switchboard CLI executable or absolute path for this call.
---@field cwd? string Working directory used to resolve the active agent.
---@field text? string Explicit text to send.
---@field lines? string[] Lines to send.
---@field line1? integer First selected line.
---@field line2? integer Last selected line.
---@field submit? boolean Submit sent text with Enter.
---@field select_agent? boolean Open the agent selector before sending.

---@type SwitchboardCommandsConfig
local defaults = {
  command = "switchboard",
  submit = true,
  select_agent = false,
}

local config = vim.deepcopy(defaults)

local function selected_line_range(opts)
  if opts.line1 and opts.line2 then
    return math.min(opts.line1, opts.line2), math.max(opts.line1, opts.line2)
  end

  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    local start_line = vim.fn.getpos("v")[2]
    local end_line = vim.fn.getcurpos()[2]
    return math.min(start_line, end_line), math.max(start_line, end_line)
  end

  local start_line = vim.fn.getpos("'<")[2]
  local end_line = vim.fn.getpos("'>")[2]
  if start_line > 0 and end_line > 0 then
    return math.min(start_line, end_line), math.max(start_line, end_line)
  end

  local line = vim.api.nvim_win_get_cursor(0)[1]
  return line, line
end

local function selection_from_positions(start_pos, end_pos, mode)
  local start_line = start_pos[2]
  local start_col = start_pos[3]
  local end_line = end_pos[2]
  local end_col = end_pos[3]

  if start_line == 0 or end_line == 0 then return nil end
  if start_line > end_line or (start_line == end_line and start_col > end_col) then
    start_line, end_line = end_line, start_line
    start_col, end_col = end_col, start_col
  end

  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  if #lines == 0 then return nil end

  if mode == "V" then
    return table.concat(lines, "\n")
  end

  if mode == "\22" then
    local out = {}
    for index, line in ipairs(lines) do
      local first_col = math.min(start_col, end_col)
      local last_col = math.max(start_col, end_col)
      out[index] = string.sub(line, first_col, last_col)
    end
    return table.concat(out, "\n")
  end

  lines[#lines] = string.sub(lines[#lines], 1, end_col)
  lines[1] = string.sub(lines[1], start_col)
  return table.concat(lines, "\n")
end

local function visual_selection()
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    return selection_from_positions(vim.fn.getpos("v"), vim.fn.getcurpos(), mode)
  end
  return selection_from_positions(vim.fn.getpos("'<"), vim.fn.getpos("'>"), "v")
end

local function selected_text(opts)
  if opts.text and opts.text ~= "" then return opts.text end
  if opts.lines then return table.concat(opts.lines, "\n") end
  return visual_selection()
end

local function write_temp(text)
  local path = vim.fn.tempname()
  local file = assert(io.open(path, "wb"))
  file:write(text)
  file:close()
  return path
end

local function current_file()
  local file = vim.api.nvim_buf_get_name(0)
  if file == "" then
    vim.notify("switchboard: current buffer has no file", vim.log.levels.WARN)
    return nil
  end

  return file
end

local function run(args, on_exit)
  if vim.system then
    local ok, job = pcall(vim.system, args, { text = true }, vim.schedule_wrap(function(result)
      on_exit(result.code, result.stderr or "")
    end))
    if not ok then
      on_exit(1, tostring(job))
    end
    return
  end

  local stderr = {}
  local job = vim.fn.jobstart(args, {
    stderr_buffered = true,
    on_stderr = function(_, data)
      stderr = data or {}
    end,
    on_exit = function(_, code)
      on_exit(code, table.concat(stderr, "\n"))
    end,
  })
  if job <= 0 then
    on_exit(1, "failed to start " .. args[1])
  end
end

---@param opts? SwitchboardCommandsConfig
function M.setup(opts)
  config = vim.tbl_deep_extend("force", defaults, opts or {})
end

local function send_text(text, opts)
  opts = opts or {}
  if not text or text == "" then
    vim.notify("switchboard: no selection to send", vim.log.levels.WARN)
    return
  end

  local cwd = opts.cwd or vim.uv.cwd()
  local path = write_temp(text)
  local select_agent = opts.select_agent
  if select_agent == nil then select_agent = config.select_agent end
  local submit = opts.submit
  if submit == nil then submit = config.submit end

  local args = { opts.command or config.command }
  if select_agent then
    vim.list_extend(args, { "send-popup", vim.env.TMUX_PANE or "", "--cwd", cwd, "--file", path })
    table.insert(args, "--unlink-file")
  else
    vim.list_extend(args, { "send", "--active", "--cwd", cwd, "--file", path })
  end
  if not submit then table.insert(args, "--no-submit") end

  run(args, function(code, stderr)
    if not select_agent then
      vim.fn.delete(path)
    end
    if code ~= 0 then
      local message = stderr ~= "" and stderr or "failed to send selection"
      vim.notify("switchboard: " .. message, vim.log.levels.ERROR)
    end
  end)
end

local function send_reference(file, line_reference, opts)
  opts = opts or {}
  local cwd = opts.cwd or vim.uv.cwd()
  local select_agent = opts.select_agent
  if select_agent == nil then select_agent = config.select_agent end
  local submit = opts.submit
  if submit == nil then submit = config.submit end

  local args = { opts.command or config.command }
  if select_agent then
    vim.list_extend(args, { "send-popup", vim.env.TMUX_PANE or "", "--cwd", cwd, "--reference-file", file })
  else
    vim.list_extend(args, { "send", "--active", "--cwd", cwd, "--reference-file", file })
  end
  if line_reference then vim.list_extend(args, { "--reference-line", line_reference }) end
  if not submit then table.insert(args, "--no-submit") end

  run(args, function(code, stderr)
    if code ~= 0 then
      local message = stderr ~= "" and stderr or "failed to send selection"
      vim.notify("switchboard: " .. message, vim.log.levels.ERROR)
    end
  end)
end

---@param opts? SwitchboardSendSelectionOptions
function M.send_selection(opts)
  opts = opts or {}
  send_text(selected_text(opts), opts)
end

---@param opts? SwitchboardSendSelectionOptions
function M.send_selection_reference(opts)
  opts = opts or {}
  local file = current_file()
  if not file then return end

  local start_line, end_line = selected_line_range(opts)
  local line_reference = start_line == end_line and tostring(start_line) or (start_line .. "-" .. end_line)
  send_reference(file, line_reference, opts)
end

---@param opts? SwitchboardSendSelectionOptions
function M.send_file_reference(opts)
  opts = opts or {}
  local file = current_file()
  if not file then return end

  send_reference(file, nil, opts)
end

return M
