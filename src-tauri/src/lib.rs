// These modules own the desktop app's local sqlite db + vendored libgit2
// (git.rs/review.rs) and the space-server HTTP/crypto stack (calls.rs's JWT,
// secretbox's chacha20poly1305) — all desktop/server-only per the matching
// Cargo.toml target-conditional dependency split. The mobile shell (iOS)
// never compiles them; it's a thin webview pointed at a live server instead
// (see `run()` below).
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod actor;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod app_consent;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod app_rights;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod applications;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod blogs;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod calls;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod chat;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod chatbot;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod db;
#[cfg(feature = "desktop")]
mod debug_server;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod devenv;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod documents;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod events;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod git;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod ics;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod issues;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod meetings;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod auth_modules;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod auth_security;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod calendar_feeds;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod oauth;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod organization;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod package_registry;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod payload_dispatch;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod personal;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod pipelines;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod platform;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod review;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod rights;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod secretbox;

#[cfg(feature = "desktop")]
use serde::Serialize;
#[cfg(feature = "desktop")]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(feature = "desktop")]
#[derive(Serialize)]
pub struct AppInfo {
    name: String,
    version: String,
    tauri: String,
    os: String,
    arch: String,
}

#[cfg(feature = "desktop")]
#[cfg_attr(feature = "desktop", tauri::command)]
fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Full local-first native app: 150+ commands over a local sqlite db + vendored
/// libgit2 (repo tools) + the space-server business modules. macOS/Windows/Linux
/// only — see the mobile shell variant below for iOS.
#[cfg(all(feature = "desktop", desktop))]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            applications::list_devfiles,
            blogs::list_blog_posts,
            blogs::get_blog_post,
            blogs::publish_blog_draft,
            blogs::archive_blog_post,
            applications::save_devfile,
            applications::delete_devfile,
            applications::open_in_ide,
            applications::list_ide_sessions,
            applications::report_ide_session,
            applications::list_applications,
            applications::save_application,
            applications::delete_application,
            applications::rotate_app_secret,
            applications::add_app_ssh_key,
            applications::list_app_ssh_keys,
            applications::delete_app_ssh_key,
            applications::add_app_gpg_key,
            applications::list_app_gpg_keys,
            applications::delete_app_gpg_key,
            applications::revoke_app_gpg_key,
            payload_dispatch::app_signing_key,
            payload_dispatch::rotate_app_signing_key,
            payload_dispatch::parse_application_payload,
            payload_dispatch::application_payload_classes,
            payload_dispatch::dispatch_application_payload,
            applications::issue_app_token,
            applications::verify_app_token,
            applications::revoke_app_token,
            applications::list_app_tokens,
            applications::list_marketplace_apps,
            applications::save_marketplace_app,
            applications::install_marketplace_app,
            applications::list_app_installs,
            applications::uninstall_app,
            applications::list_webhooks,
            applications::save_webhook,
            applications::delete_webhook,
            applications::deliver_webhook,
            applications::retry_webhook_delivery,
            applications::process_webhook_queue,
            applications::list_webhook_deliveries,
            applications::rotate_webhook_secret,
            applications::list_webhook_secrets,
            applications::list_chatbots,
            chatbot::list_chatbot_commands,
            app_rights::get_required_rights,
            app_rights::update_required_rights,
            app_rights::request_rights,
            app_rights::get_authorized_rights,
            app_rights::update_authorized_rights,
            app_rights::scope_approval_status,
            app_rights::approve_scope,
            app_rights::application_right_catalog,
            auth_modules::create_module,
            auth_modules::list_modules,
            auth_modules::update_module,
            auth_modules::delete_module,
            auth_modules::reorder_modules,
            auth_modules::config,
            auth_modules::set_config,
            auth_modules::reset_config,
            app_consent::request_consent_rights,
            app_consent::list_requests,
            app_consent::decide,
            organization::get_organization,
            organization::update_organization,
            organization::get_org_settings,
            organization::update_org_settings,
            auth_security::enroll_totp,
            auth_security::verify_totp_enrollment,
            auth_security::totp_scratch_codes_remaining,
            auth_security::use_totp_scratch_code,
            auth_security::issue_permanent_token,
            auth_security::permanent_tokens_for_user,
            auth_security::revoke_permanent_token_for_user,
            auth_security::issue_application_password,
            auth_security::application_passwords_for_user,
            auth_security::revoke_application_password_for_user,
            auth_security::issue_invitation,
            auth_security::redeem_invitation,
            applications::save_chatbot,
            applications::delete_chatbot,
            applications::list_ui_extensions,
            applications::save_ui_extension,
            applications::delete_ui_extension,
            git::repo_list,
            git::repo_add,
            git::repo_remove,
            git::repo_info,
            git::repo_log,
            git::repo_branches,
            git::repo_status,
            git::repo_diff,
            git::repo_stage,
            git::repo_commit,
            platform::list_profiles,
            platform::create_profile,
            platform::update_profile,
            platform::list_member_locations,
            platform::add_member_location,
            platform::remove_member_location,
            platform::list_teams,
            platform::create_team,
            platform::update_team,
            platform::archive_team,
            platform::list_team_memberships,
            platform::add_team_membership,
            platform::update_team_membership,
            platform::remove_team_membership,
            platform::list_projects,
            platform::set_project_deadline,
            platform::update_project_deadline,
            platform::list_roles,
            platform::create_role,
            platform::update_role,
            platform::archive_role,
            platform::list_rights,
            platform::list_right_groups,
            platform::seed_rights,
            platform::list_role_rights,
            platform::set_role_rights,
            platform::list_role_assignments,
            platform::create_role_assignment,
            platform::delete_role_assignment,
            platform::check_right,
            platform::list_cf_definitions,
            platform::create_cf_definition,
            platform::update_cf_definition,
            platform::archive_cf_definition,
            platform::cf_set_value,
            platform::cf_get_values,
            issues::list_issues,
            issues::create_issue,
            issues::update_issue,
            issues::set_issue_assignees,
            personal::add_project_member,
            personal::remove_project_member,
            issues::list_issue_assignees,
            issues::list_issue_statuses,
            issues::list_boards,
            issues::list_sprints,
            issues::archive_issue,
            issues::create_issue_status,
            issues::update_issue_status,
            issues::delete_issue_status,
            issues::create_board,
            issues::update_board,
            issues::delete_board,
            issues::list_board_columns,
            issues::save_board_column,
            issues::delete_board_column,
            issues::get_board_card_settings,
            issues::save_board_card_settings,
            issues::move_issue_on_board,
            issues::list_board_issues,
            issues::list_backlog_issues,
            issues::remove_issue_from_board,
            issues::create_sprint,
            issues::launch_sprint,
            issues::close_sprint,
            issues::delete_sprint,
            issues::list_swimlanes,
            issues::save_swimlane,
            issues::delete_swimlane,
            issues::list_planning_tags,
            issues::save_planning_tag,
            issues::set_issue_tags,
            issues::list_checklists,
            issues::save_checklist,
            issues::list_checklist_items,
            issues::save_checklist_item,
            issues::toggle_checklist_item,
            issues::list_time_tracking_entries,
            issues::save_time_tracking_entry,
            issues::issue_time_total,
            issues::add_issue_child,
            chat::list_channels,
            chat::get_channel,
            chat::list_channels_with_meta,
            chat::create_channel,
            chat::update_channel,
            chat::join_channel,
            chat::leave_channel,
            chat::add_channel_member,
            chat::remove_channel_member,
            chat::list_channel_members,
            chat::create_entity_channel,
            chat::get_channel_by_entity,
            chat::list_messages,
            chat::list_thread_replies,
            chat::create_message,
            chat::add_message_attachment,
            chat::update_message,
            chat::delete_message,
            chat::add_reaction,
            chat::remove_reaction,
            chat::mark_channel_read,
            review::list_reviews,
            review::get_review,
            review::update_review,
            review::list_review_participants,
            review::add_review_participant,
            review::set_participant_state,
            review::open_merge_request,
            review::review_diff,
            review::list_review_discussions,
            review::create_review_discussion,
            review::set_discussion_resolved,
            review::list_protected_branch_rules,
            review::save_protected_branch_rule,
            review::delete_protected_branch_rule,
            devenv::list_dev_environments,
            devenv::create_dev_environment,
            devenv::touch_dev_environment,
            devenv::hibernate_dev_environment,
            devenv::hibernate_idle_dev_environments,
            devenv::resume_dev_environment,
            devenv::claim_standby_dev_environment,
            devenv::save_standby_pool_policy,
            devenv::refill_standby_pool,
            devenv::delete_dev_environment,
            review::create_review_stack,
            review::list_review_stacks,
            review::list_my_review_stacks,
            review::remove_review_stack,
            review::stack_cherry_pick,
            review::restack_stack,
            review::record_external_check,
            review::list_external_checks,
            review::delete_external_check,
            review::list_quality_gate_rules,
            review::create_quality_gate_rule,
            review::update_quality_gate_rule,
            review::delete_quality_gate_rule,
            review::evaluate_quality_gate,
            review::list_safe_merge_runs,
            review::dry_run_merge,
            review::attempt_merge,
            documents::list_documents,
            documents::get_document,
            documents::create_document,
            documents::update_document,
            documents::move_document,
            documents::archive_document,
            documents::save_document,
            events::list_event_types,
            documents::list_doc_versions,
            documents::restore_doc_version,
            documents::list_document_access,
            documents::update_document_access,
            documents::import_document_folder,
            documents::upload_document_file,
            documents::get_document_file,
            documents::read_document_file,
            documents::get_document_publication,
            documents::publish_document,
            documents::get_public_document,
            documents::list_book_access,
            documents::search_book_documents,
            documents::update_book_access,
            documents::list_document_folders,
            documents::create_document_folder,
            documents::update_document_folder,
            documents::move_document_folder,
            meetings::list_meetings,
            meetings::get_meeting,
            meetings::create_meeting,
            meetings::update_meeting,
            meetings::archive_meeting,
            meetings::list_meeting_rooms,
            meetings::save_meeting_room,
            meetings::reserve_meeting_room,
            meetings::list_meeting_participants,
            meetings::invite_meeting_participant,
            meetings::set_meeting_participant_status,
            meetings::expand_meeting_occurrences,
            calls::start_livekit_server,
            calls::livekit_server_status,
            calls::join_meeting_call,
            calls::start_meeting_recording,
            calls::stop_meeting_recording,
            calls::list_meeting_recordings,
            calls::recording_actor_status,
            pipelines::list_pipeline_scripts,
            pipelines::create_pipeline_script,
            pipelines::update_pipeline_script,
            pipelines::delete_pipeline_script,
            pipelines::list_jobs_for_script,
            pipelines::list_job_runs_for_script,
            pipelines::register_worker,
            pipelines::worker_heartbeat,
            pipelines::set_worker_suspended,
            pipelines::assign_job_run,
            pipelines::list_workers,
            pipelines::create_job_artifact,
            pipelines::download_job_artifact,
            pipelines::list_job_artifacts,
            pipelines::save_test_report,
            pipelines::ingest_teamcity_test_messages,
            pipelines::list_test_reports,
            pipelines::trigger_pipeline_script,
            pipelines::trigger_pipeline_on_push,
            pipelines::trigger_pipeline_event,
            pipelines::due_scheduled_runs,
            pipelines::list_deploy_targets,
            pipelines::create_deploy_target,
            pipelines::update_deploy_target,
            pipelines::delete_deploy_target,
            pipelines::list_deployments_for_target,
            pipelines::schedule_deployment,
            pipelines::transition_deployment,
            pipelines::list_package_repositories,
            pipelines::create_package_repository,
            pipelines::update_package_repository,
            pipelines::delete_package_repository,
            pipelines::list_package_versions,
            pipelines::add_package_vulnerability,
            pipelines::dependency_overview,
            pipelines::publish_package_version,
            pipelines::download_package_payload,
            pipelines::list_package_repository_acl,
            pipelines::set_package_repository_acl,
            pipelines::remove_package_repository_acl,
            pipelines::apply_package_retention,
            pipelines::package_retention_candidates,
            package_registry::package_version_detail,
            pipelines::repository_vulnerability_report,
            pipelines::set_package_version_pinned,
            pipelines::delete_package_version,
            personal::list_todos,
            personal::list_project_todos,
            personal::list_project_member_ids,
            personal::calendar_aggregate,
            personal::create_todo,
            personal::update_todo,
            personal::set_todo_completion,
            personal::postpone_todo,
            personal::convert_todo_to_issue,
            personal::delete_todo,
            personal::list_absences,
            personal::create_absence,
            personal::update_absence,
            personal::delete_absence,
            personal::current_absences,
            personal::emit_notification,
            personal::list_notifications,
            personal::mark_notification_read,
            personal::list_subscription_settings,
            personal::get_dashboard_preferences,
            personal::set_dashboard_preferences,
            personal::list_subscription_scopes,
            personal::save_subscription_scope,
            personal::delete_subscription_scope,
            personal::save_subscription_setting,
            personal::delete_subscription_setting,
            personal::goto_search,
            personal::full_text_search,
            personal::dashboard_aggregate,
            calendar_feeds::list_calendar_feeds,
            calendar_feeds::list_calendars,
            calendar_feeds::save_calendar,
            calendar_feeds::delete_calendar,
            calendar_feeds::save_calendar_feed,
            calendar_feeds::delete_calendar_feed,
            calendar_feeds::sync_calendar_feed,
        ])
        .setup(|app| {
            let conn = db::connection(app.handle()).map_err(std::io::Error::other)?;
            db::seed(&conn).map_err(|e| std::io::Error::other(e.to_string()))?;
            // Built manually (instead of via tauri.conf.json's `app.windows`) so we
            // can attach the debug-server's console-capture init script before the
            // page ever loads. See src/debug_server.rs + skills/app-tools.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("GAIA Space")
                .inner_size(800.0, 600.0)
                .min_inner_size(480.0, 360.0)
                .resizable(true)
                .initialization_script(debug_server::init_script())
                .build()?;
            debug_server::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Mobile client: starts locally so a fresh install can choose any server.
/// The selected remote page then uses its own HTTP API and cookie-based login.
#[cfg(all(feature = "desktop", mobile))]
#[tauri::command]
fn connect_space_server(app: AppHandle, url: String) -> Result<(), String> {
    let target: tauri::Url = url.parse().map_err(|_| "Enter a valid server URL.")?;
    if target.scheme() != "https" && target.scheme() != "http" {
        return Err("Server URL must start with http:// or https://.".into());
    }
    app.get_webview_window("main")
        .ok_or("Main window is unavailable.")?
        .navigate(target)
        .map_err(|error| error.to_string())
}

#[cfg(all(feature = "desktop", mobile))]
#[tauri::command]
fn open_space_setup(app: AppHandle) -> Result<(), String> {
    // Tauri uses HTTPS for its app protocol on iOS; `tauri://localhost` is
    // retained for desktop-compatible mobile targets.
    let url = if cfg!(target_os = "ios") {
        "https://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    app.get_webview_window("main")
        .ok_or("Main window is unavailable.")?
        .navigate(url.parse().expect("valid bundled app URL"))
        .map_err(|error| error.to_string())
}

#[cfg(all(feature = "desktop", mobile))]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            connect_space_server,
            open_space_setup
        ])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("GAIA Space")
                .initialization_script(format!(
                    "window.__GAIA_SPACE_MOBILE__=true;{}",
                    debug_server::init_script()
                ))
                .build()?;
            debug_server::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
