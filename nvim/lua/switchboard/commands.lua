local M = {}

local defaults = {
  command = "switchboard",
  submit = true,
  select_agent = false,
}

local config = vim.deepcopy(defaults)

local function normalize_path(path)
  if not path or path == "" then return nil end
  return vim.uv.fs_realpath(path) or path
end

local function visual_selection()
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
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

  lines[#lines] = string.sub(lines[#lines], 1, end_col)
  lines[1] = string.sub(lines[1], start_col)
  return table.concat(lines, "\n")
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

local function run(args, on_exit)
  if vim.system then
    vim.system(args, { text = true }, vim.schedule_wrap(function(result)
      on_exit(result.code, result.stderr or "")
    end))
    return
  end

  local stderr = {}
  vim.fn.jobstart(args, {
    stderr_buffered = true,
    on_stderr = function(_, data)
      stderr = data or {}
    end,
    on_exit = function(_, code)
      on_exit(code, table.concat(stderr, "\n"))
    end,
  })
end

function M.setup(opts)
  config = vim.tbl_deep_extend("force", defaults, opts or {})
end

function M.send_selection(opts)
  opts = opts or {}
  local text = selected_text(opts)
  if not text or text == "" then
    vim.notify("switchboard: no selection to send", vim.log.levels.WARN)
    return
  end

  local cwd = normalize_path(opts.cwd or vim.uv.cwd()) or vim.uv.cwd()
  local path = write_temp(text)
  local select_agent = opts.select_agent
  if select_agent == nil then select_agent = config.select_agent end
  local submit = opts.submit
  if submit == nil then submit = config.submit end

  local args = { opts.command or config.command }
  if select_agent then
    vim.list_extend(args, { "send-popup", vim.env.TMUX_PANE or "", "--cwd", cwd, "--file", path })
  else
    vim.list_extend(args, { "send", "--active", "--cwd", cwd, "--file", path })
  end
  if not submit then table.insert(args, "--no-submit") end

  run(args, function(code, stderr)
    vim.fn.delete(path)
    if code ~= 0 then
      local message = stderr ~= "" and stderr or "failed to send selection"
      vim.notify("switchboard: " .. message, vim.log.levels.ERROR)
    end
  end)
end

return M
