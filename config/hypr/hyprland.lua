-- Hyprland configuration (Lua format)
-- Converted from hyprland.conf; .conf support is removed in Hyprland 0.57.
-- API reference: /usr/share/hypr/stubs/hl.meta.lua

local mod      = "ALT"
local launcher = "wofi"

-- hy3 keybinds.
--
-- Under a Lua config, plugin dispatchers are NOT reachable the old way:
-- `hyprctl dispatch hy3:makegroup tab` is evaluated as Lua now, so the legacy
-- `hy3:*` dispatcher names no longer work. Current hy3 master instead registers
-- Lua bindings under `hl.plugin.hy3.*` (make_group, move_focus, ...), which is
-- what the calls below use.
--
-- The locally installed hy3 build predates that (and no longer loads into
-- Hyprland 0.56.2 at all: undefined symbol _ZTI11IHyprLayout), so `hyprpm update`
-- is required. Until then these binds pop a notification instead of silently
-- doing nothing.
local function hy3(fn, ...)
    local function unavailable(reason)
        return function()
            hl.notification.create({ text = "hy3." .. fn .. ": " .. reason, timeout = 4000 })
        end
    end

    local f = hl.plugin.hy3 and hl.plugin.hy3[fn]
    if not f then return unavailable("plugin not loaded") end

    -- hy3's lua functions build a dispatcher; hl.bind runs it.
    local ok, dispatcher = pcall(f, ...)
    if not ok then return unavailable(tostring(dispatcher)) end
    return dispatcher
end

------------------
---- MONITORS ----
------------------

hl.monitor({ output = "Unknown-1",  mode = "2256x1504@60",      position = "0x0",    scale = 2 })
hl.monitor({ output = "DP-1",       mode = "1920x1080@59.99900", position = "2256x0", scale = 1.33333333 })
-- hl.monitor({ output = "DP-1", mode = "3840x2160@60.00Hz", position = "2256x0", scale = 2 })
-- hl.monitor({ output = "DP-2", mode = "1920x1080",        position = "2256x0", scale = 1.33333333 })
hl.monitor({ output = "DP-4",       mode = "1920x1080",         position = "2256x0", scale = 1.33333333 })
hl.monitor({ output = "DP-3",       mode = "2560x1440",         position = "2256x0", scale = 1.33333333 })
-- hl.monitor({ output = "DP-5", mode = "2560x1440@144", position = "2256x0", scale = 1.6 })
-- hl.monitor({ output = "DP-6", mode = "2560x1440@144", position = "2256x0", scale = 1.6 })
-- hl.monitor({ output = "DP-7", mode = "2560x1440@144", position = "2256x0", scale = 1.6 })
hl.monitor({ output = "DP-9",       mode = "2560x1440@120.00Hz", position = "2256x0", scale = 1.6 })
hl.monitor({ output = "DP-10",      mode = "2560x1440@144",     position = "2256x0", scale = 1.6 })
hl.monitor({ output = "DP-11",      mode = "2560x1440@144",     position = "2256x0", scale = 1.6 })
hl.monitor({ output = "HEADLESS-2", mode = "2480x1860@60",      position = "0x0",    scale = 2.5 })

-------------------
---- AUTOSTART ----
-------------------

hl.on("hyprland.start", function()
    -- hyprpm is not used to load hy3 any more: /var/cache/hyprpm/raph is root-owned
    -- (from a `sudo hyprpm` run), so hyprpm cannot refresh its headers. Its cached
    -- headers are for aquamarine 0.14 while the system has 0.15, so anything it
    -- builds is rejected by Hyprland's ABI check. hy3 is loaded via hl.plugin.load
    -- below instead. Re-enable this line once hyprpm is working again:
    --   sudo chown -R raph:raph /var/cache/hyprpm/raph  (then `hyprpm update`)
    -- hl.exec_cmd("hyprpm reload -n")
    hl.exec_cmd("waybar")
    hl.exec_cmd("hyprpaper")
    hl.exec_cmd("nm-applet --indicator")
    hl.exec_cmd("swaync -c ~/.config/swaync/config.json")
    hl.exec_cmd([[swayidle -w  before-sleep 'swaylock -s fill -i ~/Wallpapers/lockscreen.png']])
    hl.exec_cmd("hypridle")
    hl.exec_cmd("~/.config/hypr/scripts/waybar-hotplug-watcher.sh")
    hl.exec_cmd("dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP HYPRLAND_INSTANCE_SIGNATURE")
    hl.exec_cmd("systemctl --user start gh-notifications.service")
end)

-- hy3 is loaded directly rather than through hyprpm: hyprpm has no commit pin for
-- Hyprland 0.56.2 (its newest is 0.56.0), so it falls back to hy3 master, which
-- targets post-0.56 headers and fails to build. This .so is hy3 db28808 (the 0.56.0
-- pin) built against the installed 0.56.2 headers.
-- Rebuild after a Hyprland update:
--   git clone https://github.com/outfoxxed/hy3 && cd hy3
--   cmake -DCMAKE_BUILD_TYPE=RelWithDebInfo -B build && cmake --build build
--   cp build/libhy3.so ~/.config/hypr/modules/libhy3.so
-- (a stale /usr/local/include/hyprland tree shadows the real headers and breaks that
--  build; it needs root to remove.)
hl.plugin.load("/home/raph/.config/hypr/modules/libhy3.so")

-----------------------
---- LOOK AND FEEL ----
-----------------------

hl.config({
    general = {
        gaps_in     = 3,
        gaps_out    = 5,
        border_size = 2,

        col = {
            active_border   = { colors = { "rgba(33ccffee)", "rgba(00ff99ee)" }, angle = 45 },
            inactive_border = "rgba(595959aa)",
        },

        resize_on_border = true,
        -- extend_border_grab_area = 5,

        layout = "hy3",
    },

    misc = {
        vrr = 1,
    },

    decoration = {
        rounding = 5,

        blur = {
            enabled    = true,
            size       = 7,
            passes     = 4,
            noise      = 0.008,
            contrast   = 0.8916,
            brightness = 0.8,
        },

        shadow = {
            range        = 4,
            render_power = 3,
        },
    },

    render = {
        direct_scanout = false,
    },

    animations = {
        enabled = true,
    },

    gestures = {
        workspace_swipe_forever      = false,
        workspace_swipe_distance     = 600,
        workspace_swipe_cancel_ratio = 0.3,
        workspace_swipe_create_new   = false,
    },

    binds = {
        workspace_back_and_forth = true,
    },

    xwayland = {
        force_zero_scaling = true,
    },
})

-- Touch/trackpad workspace swipe (was: gestures { workspace_swipe = true, workspace_swipe_fingers = 3 })
-- hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })

----------------------
---- ANIMATIONS   ----
----------------------

hl.curve("windowIn",     { type = "bezier", points = { { 0.06, 0.71 }, { 0.25, 1 } } })
hl.curve("windowResize", { type = "bezier", points = { { 0.04, 0.67 }, { 0.38, 1 } } })

hl.animation({ leaf = "windowsIn",   enabled = true, speed = 1,   bezier = "windowIn",     style = "slide" }) -- popin 20%
hl.animation({ leaf = "windowsOut",  enabled = true, speed = 3,   bezier = "windowIn",     style = "slide" }) -- popin 70%
hl.animation({ leaf = "windowsMove", enabled = true, speed = 1.8, bezier = "windowResize" })
hl.animation({ leaf = "border",      enabled = true, speed = 10,  bezier = "default" })
hl.animation({ leaf = "borderangle", enabled = true, speed = 8,   bezier = "default" })
hl.animation({ leaf = "fade",        enabled = true, speed = 3,   bezier = "default" })
hl.animation({ leaf = "workspaces",  enabled = true, speed = 0.5, bezier = "default" })

---------------
---- INPUT ----
---------------

hl.config({
    input = {
        kb_layout  = "us",
        kb_variant = "",
        kb_model   = "",

        -- caps:swapescape -> physical Esc emits Caps Lock, physical Caps emits Escape
        kb_options = "compose:ralt,caps:swapescape",
        kb_rules   = "",

        repeat_rate  = 50,
        repeat_delay = 200,

        follow_mouse = 1,

        touchpad = {
            natural_scroll       = false,
            disable_while_typing = true,
        },

        sensitivity = 0.75, -- -1.0 - 1.0, 0 means no modification.
    },
})

----------------
---- PLUGIN ----
----------------

-- hy3 config values. These resolve only once hy3 is loaded; until then
-- `hyprctl configerrors` reports them as unknown config keys.
hl.config({
    plugin = {
        hy3 = {
            tabs = {
                height      = 5,
                padding     = 8,
                render_text = false,
            },

            autotile = {
                enable         = true,
                trigger_width  = 800,
                trigger_height = 500,
            },
        },
    },
})

--------------------------------
---- WINDOWS AND WORKSPACES ----
--------------------------------

-- hl.layer_rule({ match = { namespace = "wofi" },   blur = true })
-- hl.layer_rule({ match = { namespace = "ironbar" }, blur = true })

-- hl.window_rule({ match = { class = "^(.*telegram.*)$" }, workspace = "10" })
-- hl.window_rule({ match = { class = "^(.*slack.*)$" },    workspace = "10" })
-- hl.window_rule({ match = { class = "^(.*discord.*)$" },  workspace = "10" })
-- hl.window_rule({ match = { class = "^(qemu-system-x86_64)$" }, render_unfocused = true })
-- hl.window_rule({ match = { class = "^(qemu-system-x86_64)$" }, float = false })
-- hl.window_rule({ match = { class = "^(Sxiv)$" }, float = false })
--
-- hl.window_rule({ match = { class = "^(opensnitch_ui)$" }, float = true, dim_around = true })
-- hl.window_rule({ match = { class = "^(org.kde.polkit-kde-authentication-agent-1)$" }, float = true, dim_around = true })
-- hl.window_rule({ match = { class = "^(gcr-prompter)$" }, float = true, dim_around = true })
-- hl.window_rule({
--     match      = { class = "^(org.freedesktop.impl.portal.desktop.kde)$" },
--     float      = true,
--     size       = "1000 700",
--     center     = true,
--     dim_around = true,
-- })
--
-- hl.window_rule({ match = { class = "^(AlacrittyFloating)$" }, float = true })

---------------------
---- KEYBINDINGS ----
---------------------

hl.bind("PRINT", hl.dsp.exec_cmd("hyprctl dispatch sendkey caps_lock"))
hl.bind(mod .. " + Return", hl.dsp.exec_cmd("sh ~/.config/alacritty/go_to_dir.sh"))
hl.bind("XF86PowerOff", hl.dsp.exec_cmd("sh ~/.scripts/microphone/toggle_microphone"))

hl.bind(mod .. " + SHIFT + p", hl.dsp.exec_cmd("swaylock -s fill -i ~/Wallpapers/lockscreen.png"))

hl.bind(mod .. " + SHIFT + m", hl.dsp.exit())

hl.bind(mod .. " + SHIFT + return", hl.dsp.exec_cmd("alacritty --class AlacrittyFloating"))
hl.bind(mod .. " + D", hl.dsp.exec_cmd(launcher .. " --show drun"))
hl.bind(mod .. " + G", hl.dsp.exec_cmd("sh ~/.config/hypr/scripts/firejail-launch.sh"))
hl.bind(mod .. " + SHIFT + q", hl.dsp.window.close())

hl.bind(mod .. " + f",         hl.dsp.window.fullscreen({ mode = "maximized" }))
hl.bind(mod .. " + SHIFT + f", hl.dsp.window.fullscreen({ mode = "fullscreen" }))
hl.bind(mod .. " + SHIFT + space", hl.dsp.window.float({ action = "toggle" }))

hl.bind(mod .. " + s", hl.dsp.exec_cmd("sh ~/.scripts/screens/screenshotWayland.sh"))
hl.bind(mod .. " + z",         hy3("make_group", "tab"))
hl.bind(mod .. " + SHIFT + z", hy3("make_group", "tab", { toggle = true }))
hl.bind(mod .. " + a",         hy3("change_focus", "raise"))
hl.bind(mod .. " + b",         hy3("change_focus", "lower"))
hl.bind(mod .. " + e",         hy3("expand", "expand"))
hl.bind(mod .. " + SHIFT + e", hy3("expand", "shrink"))

-- hy3 has no lua equivalent for the old `hy3:focustab, mouse`, and that legacy arg
-- was already a no-op in current hy3 (its parser accepts only l/r/index); hy3 handles
-- clicks on a tab bar itself.
-- hl.bind("mouse:272", hy3("focus_tab", ...), { non_consuming = true })
hl.bind("mouse_down", hy3("focus_tab", { direction = "l", mouse = "require_hovered" }), { non_consuming = true })
hl.bind("mouse_up",   hy3("focus_tab", { direction = "r", mouse = "require_hovered" }), { non_consuming = true })

hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"))
hl.bind("XF86AudioStop", hl.dsp.exec_cmd("playerctl -a stop"))
hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"))
hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"))

hl.bind(mod .. " + SHIFT + s", hl.dsp.exec_cmd([[grim -g "$(slurp)" - | wl-copy]]))

hl.bind(mod .. " + h", hy3("move_focus", "l"))
hl.bind(mod .. " + j", hy3("move_focus", "d"))
hl.bind(mod .. " + k", hy3("move_focus", "u"))
hl.bind(mod .. " + l", hy3("move_focus", "r"))

hl.bind(mod .. " + CONTROL + h", hy3("move_focus", "l", { visible = true }))
hl.bind(mod .. " + CONTROL + j", hy3("move_focus", "d", { visible = true }))
hl.bind(mod .. " + CONTROL + k", hy3("move_focus", "u", { visible = true }))
hl.bind(mod .. " + CONTROL + l", hy3("move_focus", "r", { visible = true }))

hl.bind(mod .. " + SHIFT + h", hy3("move_window", "l", { once = true }))
hl.bind(mod .. " + SHIFT + j", hy3("move_window", "d", { once = true }))
hl.bind(mod .. " + SHIFT + k", hy3("move_window", "u", { once = true }))
hl.bind(mod .. " + SHIFT + l", hy3("move_window", "r", { once = true }))

hl.bind(mod .. " + CONTROL + SHIFT + h", hy3("move_window", "l", { once = true, visible = true }))
hl.bind(mod .. " + CONTROL + SHIFT + j", hy3("move_window", "d", { once = true, visible = true }))
hl.bind(mod .. " + CONTROL + SHIFT + k", hy3("move_window", "u", { once = true, visible = true }))
hl.bind(mod .. " + CONTROL + SHIFT + l", hy3("move_window", "r", { once = true, visible = true }))

-- Workspaces. Key 4 is intentionally absent here: it is bound to hy3:makegroup below.
local workspaceKeys = {
    { key = "1",   ws = "01" },
    { key = "2",   ws = "02" },
    { key = "3",   ws = "03" },
    { key = "5",   ws = "05" },
    { key = "6",   ws = "06" },
    { key = "7",   ws = "07" },
    { key = "8",   ws = "08" },
    { key = "9",   ws = "09" },
    { key = "0",   ws = "10" },
    { key = "F1",  ws = "11" },
    { key = "F2",  ws = "12" },
    { key = "F3",  ws = "13" },
    { key = "F4",  ws = "14" },
    { key = "F5",  ws = "15" },
    { key = "F6",  ws = "16" },
    { key = "F7",  ws = "17" },
    { key = "F8",  ws = "18" },
    { key = "F9",  ws = "19" },
    { key = "F10", ws = "20" },
}

for _, w in ipairs(workspaceKeys) do
    hl.bind(mod .. " + " .. w.key, hl.dsp.focus({ workspace = w.ws }))
end

-- movetoworkspacesilent, including 4 -> workspace 04
local moveKeys = {
    { key = "1",   ws = "01" },
    { key = "2",   ws = "02" },
    { key = "3",   ws = "03" },
    { key = "4",   ws = "04" },
    { key = "5",   ws = "05" },
    { key = "6",   ws = "06" },
    { key = "7",   ws = "07" },
    { key = "8",   ws = "08" },
    { key = "9",   ws = "09" },
    { key = "0",   ws = "10" },
    { key = "F1",  ws = "11" },
    { key = "F2",  ws = "12" },
    { key = "F3",  ws = "13" },
    { key = "F4",  ws = "14" },
    { key = "F5",  ws = "15" },
    { key = "F6",  ws = "16" },
    { key = "F7",  ws = "17" },
    { key = "F8",  ws = "18" },
    { key = "F9",  ws = "19" },
    { key = "F10", ws = "20" },
}

for _, w in ipairs(moveKeys) do
    hl.bind(mod .. " + SHIFT + " .. w.key, hl.dsp.window.move({ workspace = w.ws, follow = false }))
end

-- Cycle through workspaces
hl.bind(mod .. " + o", hl.dsp.focus({ workspace = "e+1" }))
hl.bind(mod .. " + i", hl.dsp.focus({ workspace = "e-1" }))

hl.bind("XF86AudioRaiseVolume",
    hl.dsp.exec_cmd([[sh -c 'if [ "$(pamixer --get-volume)" -le 10 ]; then pamixer --unmute --increase 1; else pamixer --unmute --increase 5; fi']]),
    { repeating = true })
hl.bind("XF86AudioLowerVolume",
    hl.dsp.exec_cmd([[sh -c 'if [ "$(pamixer --get-volume)" -le 10 ]; then pamixer --unmute --decrease 1; else pamixer --unmute --decrease 5; fi']]),
    { repeating = true })
hl.bind("XF86AudioMute",           hl.dsp.exec_cmd("pamixer --toggle-mute"),                   { repeating = true })
hl.bind("XF86AudioPrev",           hl.dsp.exec_cmd("mpc --host /tmp/mpd.unix prev"),           { repeating = true })
hl.bind("XF86AudioNext",           hl.dsp.exec_cmd("mpc --host /tmp/mpd.unix next"),           { repeating = true })
hl.bind("XF86AudioPlay",           hl.dsp.exec_cmd("mpc --host /tmp/mpd.unix toggle"),         { repeating = true })
hl.bind("XF86AudioMedia",          hl.dsp.exec_cmd("~/.scripts/crypto/openInExplorer.sh"),     { repeating = true })
hl.bind("Print",                   hl.dsp.exec_cmd("~/.scripts/system/changeTTY.sh"),          { repeating = true })
hl.bind("XF86MonBrightnessUp",     hl.dsp.exec_cmd("brightnessctl s +8%"),                     { repeating = true })
hl.bind("XF86MonBrightnessDown",   hl.dsp.exec_cmd("brightnessctl s 8%-"),                     { repeating = true })
hl.bind("XF86KbdBrightnessUp",     hl.dsp.exec_cmd("kbdlight up"),                             { repeating = true })
hl.bind("XF86KbdBrightnessDown",   hl.dsp.exec_cmd("kbdlight down"),                           { repeating = true })

hl.bind("CONTROL + SPACE", hl.dsp.exec_cmd("makoctl dismiss"), { repeating = true })

hl.bind(mod .. " + v", hy3("make_group", "v"))
hl.bind(mod .. " + 4", hy3("make_group", "h"))

-----------------
---- SUBMAPS ----
-----------------

hl.bind(mod .. " + r", hl.dsp.submap("resize"))
hl.bind(mod .. " + m", hl.dsp.submap("mode"))

hl.define_submap("mode", "escape", function()
    hl.bind(mod .. " + o", hl.dsp.submap("crypto"))
    hl.bind(mod .. " + s", hl.dsp.submap("screen"))
    hl.bind(mod .. " + b", hl.dsp.submap("bluetooth"))
    hl.bind(mod .. " + p", hl.dsp.submap("password"))
    hl.bind(mod .. " + f", hl.dsp.submap("file"))
    hl.bind(mod .. " + m", hl.dsp.submap("music"))
    hl.bind(mod .. " + w", hl.dsp.submap("workspaces"))
    hl.bind("escape", hl.dsp.submap(""))
end)

hl.define_submap("music", "escape", function()
    hl.bind(mod .. " + r", hl.dsp.exec_cmd("sh ~/.scripts/music/restart_mpd"))
    hl.bind(mod .. " + s", hl.dsp.exec_cmd("sh  ~/.scripts/music/move_playing_to_library"))
    hl.bind(mod .. " + k", hl.dsp.exec_cmd("sh  ~/.scripts/music/kill_soulseek_watcher"))
    hl.bind(mod .. " + w", hl.dsp.exec_cmd("sh  ~/.scripts/music/watch_soulseek"))
    hl.bind(mod .. " + h", hl.dsp.exec_cmd("sh  ~/.scripts/show_helper music"))
    hl.bind(mod .. " + m", hl.dsp.exec_cmd("sh  ~/.scripts/music/seek_middle"))
    -- NOTE: ALT+d was bound twice in the .conf; both kept for fidelity.
    hl.bind(mod .. " + d", hl.dsp.exec_cmd("alacritty -e ~/.scripts/music/connectToDenon.sh on"))
    hl.bind(mod .. " + q", hl.dsp.exec_cmd("alacritty -e sh  ~/.scripts/music/connectToDenon.sh off"))

    hl.bind(mod .. " + u", hl.dsp.exec_cmd("pamixer --unmute --increase 5"))
    hl.bind(mod .. " + d", hl.dsp.exec_cmd("pamixer --unmute --decrease 5"))

    hl.bind(mod .. " + n", hl.dsp.exec_cmd("mpc next"))
    hl.bind(mod .. " + p", hl.dsp.exec_cmd("mpc prev"))
    hl.bind(mod .. " + t", hl.dsp.exec_cmd("mpc toggle"))
    hl.bind(mod .. " + f", hl.dsp.exec_cmd("mpc seek +5"))
    hl.bind(mod .. " + b", hl.dsp.exec_cmd("mpc seek -5"))
    hl.bind("escape", hl.dsp.submap(""))
end)

hl.define_submap("file", "escape", function()
    hl.bind(mod .. " + o", hl.dsp.exec_cmd("sh ~/.scripts/file/open"))
    hl.bind(mod .. " + f", hl.dsp.exec_cmd("sh ~/.scripts/file/search"))
    hl.bind("escape", hl.dsp.submap(""))
end)

hl.define_submap("password", "escape", function()
    hl.bind(mod .. " + r", hl.dsp.exec_cmd([[sh  -c "pass -c Perso/ratiju && notify-send Password 'Password copied to clipboard'"]]))
    hl.bind(mod .. " + c", hl.dsp.exec_cmd("sh  ~/.scripts/password/copy_password"))
    hl.bind(mod .. " + e", hl.dsp.exec_cmd("alacritty -e sh  ~/.scripts/password/edit_password"))
    hl.bind(mod .. " + h", hl.dsp.exec_cmd("sh  ~/.scripts/show_helper password"))
    -- explicit exit bind (the .conf had `bind = , escape, submap, reset`)
    hl.bind("escape", hl.dsp.submap(""))
end)

hl.define_submap("bluetooth", "escape", function()
    hl.bind("escape", hl.dsp.submap(""))
    hl.bind(mod .. " + c", hl.dsp.exec_cmd("sh ~/.scripts/bluetooth/connect"))
    hl.bind(mod .. " + d", hl.dsp.exec_cmd("sh ~/.scripts/bluetooth/disconnect"))
end)

hl.define_submap("screen", "escape", function()
    hl.bind("escape", hl.dsp.submap(""))
    hl.bind(mod .. " + r", hl.dsp.exec_cmd([[sh -c "~/.scripts/screens/record_screen"]]))
    hl.bind(mod .. " + u", hl.dsp.exec_cmd([[sh -c "~/.scripts/screens/upload_last_screen.sh"]]))
end)

hl.define_submap("resize", "escape", function()
    hl.bind("escape", hl.dsp.submap(""))
    hl.bind("l", hl.dsp.window.resize({ x = -20, y = 0,   relative = true }))
    hl.bind("h", hl.dsp.window.resize({ x = 20,  y = 0,   relative = true }))
    hl.bind("j", hl.dsp.window.resize({ x = 0,   y = -20, relative = true }))
    hl.bind("k", hl.dsp.window.resize({ x = 0,   y = 20,  relative = true }))
end)

hl.define_submap("workspaces", "escape", function()
    hl.bind("escape", hl.dsp.submap(""))
    hl.bind(mod .. " + i", hl.dsp.workspace.move({ monitor = 0 }))
    hl.bind(mod .. " + e", hl.dsp.workspace.move({ monitor = 1 }))
end)

hl.define_submap("crypto", "escape", function()
    hl.bind("escape", hl.dsp.submap(""))
    hl.bind(mod .. " + c", hl.dsp.exec_cmd("~/.scripts/crypto/copyToGuest.sh"))
    hl.bind(mod .. " + h", hl.dsp.exec_cmd("~/.scripts/crypto/convertHexToDec.sh"))
    hl.bind(mod .. " + m", hl.dsp.exec_cmd("~/.scripts/crypto/changeMode.sh"))
    hl.bind(mod .. " + p", hl.dsp.exec_cmd("~/.scripts/crypto/openOnPoocoin.sh"))
    hl.bind(mod .. " + t", hl.dsp.exec_cmd("~/.scripts/crypto/openOnPhalcon.sh"))
    hl.bind(mod .. " + l", hl.dsp.exec_cmd("~/.scripts/crypto/findLinkedTransaction.sh"))
    hl.bind(mod .. " + v", hl.dsp.exec_cmd("~/.scripts/crypto/copyFromGuest.sh"))
    hl.bind(mod .. " + w", hl.dsp.exec_cmd("alacritty -e sh ~/.scripts/crypto/startWallet.sh"))
    hl.bind(mod .. " + a", hl.dsp.exec_cmd("~/.scripts/crypto/analyze.sh"))
    hl.bind(mod .. " + e", hl.dsp.exec_cmd("~/.scripts/crypto/openInExplorer.sh"))
    hl.bind(mod .. " + j", hl.dsp.exec_cmd("~/.scripts/crypto/openInCow.sh"))
    hl.bind(mod .. " + o", hl.dsp.exec_cmd("~/.scripts/crypto/openInOtterscan.sh"))
    hl.bind(mod .. " + u", hl.dsp.exec_cmd("/home/raph/sources/stt-hl/stt-hl.sh"))
end)
