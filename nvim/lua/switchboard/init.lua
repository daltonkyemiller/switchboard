local M = {}

---@class SwitchboardSendConfig
---@field submit? boolean Submit sent text with Enter. Defaults to true.
---@field select_agent? boolean Open the agent selector before sending. Defaults to false.
---@field focus? boolean Focus the target agent after sending. Defaults to false.

---@class SwitchboardConfig
---@field enabled? boolean Write picker context from Neovim. Defaults to true.
---@field debounce_ms? integer Debounce for context writes. Defaults to 150.
---@field max_open_buffers? integer Maximum open buffers stored in picker context. Defaults to 20.
---@field max_recent_files? integer Maximum recent files stored in picker context. Defaults to 50.
---@field state_dir? string Fallback/cache directory where picker context JSON is written.
---@field command? string Switchboard CLI executable or absolute path. Defaults to "switchboard".
---@field send? SwitchboardSendConfig Selection sending defaults.

local function default_state_dir()
  local state_home = vim.env.XDG_STATE_HOME or (vim.env.HOME and (vim.env.HOME .. "/.local/state"))
  if not state_home or state_home == "" then
    state_home = vim.fn.stdpath("state")
  end
  return state_home .. "/switchboard/nvim-context"
end

---@type SwitchboardConfig
local defaults = {
  enabled = true,
  debounce_ms = 150,
  max_open_buffers = 20,
  max_recent_files = 50,
  state_dir = default_state_dir(),
  command = "switchboard",
  send = {
    submit = true,
    select_agent = false,
    focus = false,
  },
}

local config = vim.deepcopy(defaults)
local group = vim.api.nvim_create_augroup("SwitchboardNvimContext", { clear = true })
local timer = nil
local jobs = {}

local function normalize_path(path)
  if not path or path == "" then return nil end
  return vim.uv.fs_realpath(path) or path
end

local function is_readable_file(path)
  return path and path ~= "" and vim.fn.filereadable(path) == 1
end

local function in_cwd(path, cwd)
  return path == cwd or vim.startswith(path, cwd .. "/")
end

local function unique_paths(paths, max_items)
  local out = {}
  local seen = {}
  for _, path in ipairs(paths) do
    if path and not seen[path] then
      seen[path] = true
      out[#out + 1] = path
      if #out >= max_items then break end
    end
  end
  return out
end

local function readable_file_in_cwd(path, cwd)
  local normalized = normalize_path(path)
  if not is_readable_file(normalized) then return nil end
  if not in_cwd(normalized, cwd) then return nil end
  return normalized
end

local function open_buffers(cwd)
  local files = {}
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].buflisted then
      files[#files + 1] = readable_file_in_cwd(vim.api.nvim_buf_get_name(buf), cwd)
    end
  end
  return unique_paths(files, config.max_open_buffers)
end

local function recent_files(cwd)
  local files = {}
  for _, oldfile in ipairs(vim.v.oldfiles or {}) do
    files[#files + 1] = readable_file_in_cwd(oldfile, cwd)
  end
  return unique_paths(files, config.max_recent_files)
end

local function context_payload()
  local cwd = normalize_path(vim.uv.cwd())
  if not cwd then return nil end
  local current_file = readable_file_in_cwd(vim.api.nvim_buf_get_name(0), cwd)
  local alternate_buf = vim.fn.bufnr("#")
  local alternate_file = alternate_buf > 0 and readable_file_in_cwd(vim.api.nvim_buf_get_name(alternate_buf), cwd) or nil

  return {
    version = 1,
    cwd = cwd,
    tmux_pane = vim.env.TMUX_PANE or "",
    updated_at = os.time(),
    current_file = current_file,
    alternate_file = alternate_file,
    open_buffers = open_buffers(cwd),
    recent_files = recent_files(cwd),
  }
end

local function write_context_file(payload)
  vim.fn.mkdir(config.state_dir, "p")
  local ok, encoded = pcall(vim.json.encode, payload)
  if not ok then return end

  local path = config.state_dir .. "/" .. vim.fn.sha256(payload.cwd):sub(1, 16) .. ".json"
  vim.fn.writefile({ encoded }, path)
end

local function run_switchboard(args, stdin, on_exit)
  local command = { config.command }
  vim.list_extend(command, args)

  if vim.system then
    local job = nil
    local ok = pcall(function()
      job = vim.system(command, { text = true, stdin = stdin }, vim.schedule_wrap(function(result)
        if job then
          jobs[job] = nil
        end
        on_exit(result.code)
      end))
    end)
    if not ok or not job then
      on_exit(1)
      return
    end
    jobs[job] = true
    return
  end

  local job = vim.fn.jobstart(command, {
    stdin = "pipe",
    on_exit = function(_, code)
      vim.schedule(function()
        on_exit(code)
      end)
    end,
  })
  if job <= 0 then
    on_exit(1)
    return
  end

  vim.fn.chansend(job, stdin)
  vim.fn.chanclose(job, "stdin")
end

local function run_switchboard_sync(args, stdin)
  local command = { config.command }
  vim.list_extend(command, args)

  if vim.system then
    local ok, job = pcall(vim.system, command, { text = true, stdin = stdin })
    if not ok then return end
    job:wait(500)
    return
  end

  vim.fn.system(command, stdin)
end

local function report_context(payload)
  local ok, encoded = pcall(vim.json.encode, payload)
  if not ok then return end

  run_switchboard_sync({ "nvim-context", "report" }, encoded)
end

local function release_context()
  local payload = context_payload()
  if not payload then return end
  local ok, encoded = pcall(vim.json.encode, payload)
  if not ok then return end

  run_switchboard_sync({ "nvim-context", "release" }, encoded)
end

function M.write_context()
  if not config.enabled then return end
  local payload = context_payload()
  if not payload then return end

  write_context_file(payload)
  report_context(payload)
end

function M.schedule_write()
  if not config.enabled then return end
  if timer then
    timer:stop()
    timer:close()
    timer = nil
  end

  timer = vim.uv.new_timer()
  if not timer then
    M.write_context()
    return
  end

  timer:start(config.debounce_ms, 0, function()
    timer:stop()
    timer:close()
    timer = nil
    vim.schedule(M.write_context)
  end)
end

---@param opts? SwitchboardConfig
function M.setup(opts)
  config = vim.tbl_deep_extend("force", defaults, opts or {})
  require("switchboard.commands").setup({
    command = config.command,
    submit = config.send.submit,
    select_agent = config.send.select_agent,
    focus = config.send.focus,
  })
  vim.api.nvim_clear_autocmds({ group = group })

  if not config.enabled then return end

  vim.api.nvim_create_autocmd({
    "VimEnter",
    "BufEnter",
    "WinEnter",
    "BufWritePost",
    "DirChanged",
  }, {
    group = group,
    callback = M.schedule_write,
  })

  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = group,
    callback = release_context,
  })

  vim.api.nvim_create_user_command("SwitchboardWriteContext", M.write_context, { force = true })
  M.schedule_write()
end

return M
