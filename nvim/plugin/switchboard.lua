if vim.g.loaded_switchboard == 1 then
  return
end

vim.g.loaded_switchboard = 1

vim.api.nvim_create_user_command("SwitchboardSendSelection", function(opts)
  local lines = nil
  if opts.range > 0 then
    lines = vim.api.nvim_buf_get_lines(0, opts.line1 - 1, opts.line2, false)
  end

  require("switchboard.commands").send_selection({
    lines = lines,
    select_agent = opts.bang,
  })
end, {
  bang = true,
  range = true,
})

vim.api.nvim_create_user_command("SwitchboardSendReference", function(opts)
  require("switchboard.commands").send_selection_reference({
    line1 = opts.range > 0 and opts.line1 or nil,
    line2 = opts.range > 0 and opts.line2 or nil,
    select_agent = opts.bang,
  })
end, {
  bang = true,
  range = true,
})

vim.api.nvim_create_user_command("SwitchboardSendFileReference", function(opts)
  require("switchboard.commands").send_file_reference({
    select_agent = opts.bang,
  })
end, {
  bang = true,
})
