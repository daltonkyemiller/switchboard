local M = {}

local function default_state_dir()
  local state_home = vim.env.XDG_STATE_HOME or (vim.env.HOME and (vim.env.HOME .. "/.local/state"))
  if not state_home or state_home == "" then
    state_home = vim.fn.stdpath("state")
  end
  return state_home .. "/switchboard/nvim-context"
end

local defaults = {
  enabled = true,
  debounce_ms = 150,
  max_open_buffers = 20,
  max_recent_files = 50,
  state_dir = default_state_dir(),
}

local config = vim.deepcopy(defaults)
local group = vim.api.nvim_create_augroup("SwitchboardNvimContext", { clear = true })
local timer = nil

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

function M.write_context()
  if not config.enabled then return end

  local cwd = normalize_path(vim.uv.cwd())
  if not cwd then return end

  vim.fn.mkdir(config.state_dir, "p")
  local current_file = readable_file_in_cwd(vim.api.nvim_buf_get_name(0), cwd)
  local alternate_buf = vim.fn.bufnr("#")
  local alternate_file = alternate_buf > 0 and readable_file_in_cwd(vim.api.nvim_buf_get_name(alternate_buf), cwd) or nil

  local payload = {
    version = 1,
    cwd = cwd,
    tmux_pane = vim.env.TMUX_PANE or "",
    updated_at = os.time(),
    current_file = current_file,
    alternate_file = alternate_file,
    open_buffers = open_buffers(cwd),
    recent_files = recent_files(cwd),
  }

  local ok, encoded = pcall(vim.json.encode, payload)
  if not ok then return end

  local path = config.state_dir .. "/" .. vim.fn.sha256(cwd):sub(1, 16) .. ".json"
  vim.fn.writefile({ encoded }, path)
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

function M.setup(opts)
  config = vim.tbl_deep_extend("force", defaults, opts or {})
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

  vim.api.nvim_create_user_command("SwitchboardWriteContext", M.write_context, { force = true })
  M.schedule_write()
end

return M
