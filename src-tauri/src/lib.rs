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
pub mod availability;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod blogs;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod calls;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod channel_feeds;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod channel_notes;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod chat;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod chat_links;
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
pub mod finance;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod git;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod git_hosting;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod ics;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod issues;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod leads;
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
            applications::list_app_parameters,
            applications::save_app_parameter,
            applications::delete_app_parameter,
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
            git_hosting::create_hosted_repo,
            git_hosting::list_hosted_repos,
            git_hosting::delete_hosted_repo,
            git_hosting::hosted_repo_clone_url,
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
            git::repo_fetch,
            git::repo_pull,
            git::repo_push,
            git::repo_checkout,
            git::repo_branch_create,
            git::repo_tags,
            git::repo_remotes,
            git::repo_stash_save,
            git::repo_stash_pop,
            git::repo_stash_list,
            git::repo_commit_files,
            git::repo_tree,
            git::repo_unstage,
            git::repo_worktrees,
            platform::list_profiles,
            platform::list_directory_feed,
            platform::list_directory_calendar,
            platform::create_profile,
            platform::update_profile,
            platform::get_profile_email_status,
            platform::set_profile_email_status,
            platform::list_messenger_contacts,
            platform::save_messenger_contact,
            platform::delete_messenger_contact,
            platform::list_principals,
            platform::list_member_locations,
            platform::list_desk_assignments,
            platform::save_desk_assignment,
            platform::remove_desk_assignment,
            platform::add_member_location,
            platform::remove_member_location,
            platform::list_locations,
            platform::save_location,
            platform::location_channel,
            platform::list_teams,
            platform::create_team,
            platform::update_team,
            platform::archive_team,
            platform::list_team_memberships,
            platform::add_team_membership,
            platform::update_team_membership,
            platform::remove_team_membership,
            platform::list_membership_edit_requests,
            platform::request_membership_edit,
            platform::decide_membership_edit,
            platform::list_projects,
            platform::set_project_deadline,
            platform::update_project_deadline,
            platform::set_project_lead,
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
            platform::list_project_role_templates,
            platform::create_project_role_template,
            platform::archive_project_role_template,
            platform::list_project_roles,
            platform::create_project_role,
            platform::archive_project_role,
            platform::list_project_team_roles,
            platform::assign_project_team_role,
            platform::remove_project_team_role,
            platform::list_cf_definitions,
            platform::create_cf_definition,
            platform::update_cf_definition,
            platform::archive_cf_definition,
            platform::cf_set_value,
            platform::cf_get_values,
            platform::get_profile,
            platform::get_team,
            platform::get_role,
            platform::get_project,
            platform::create_project,
            platform::update_project,
            platform::delete_project,
            platform::is_admin,
            issues::list_issues,
            // Desktop lost the issue detail pane: the command carries its
            // #[tauri::command] attribute and the web transport dispatches it,
            // but it was never registered here, so every desktop open failed with
            // "Command get_issue_detail not found".
            issues::get_issue,
            issues::get_issue_detail,
            issues::create_issue,
            issues::clone_issue,
            issues::move_issue_to_project,
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
            issues::bulk_move_issues_on_board,
            issues::bulk_remove_issues_from_board,
            issues::bulk_update_issues_sprints,
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
            issues::list_issue_attachments,
            issues::add_issue_attachment,
            issues::delete_issue_attachment,
            issues::list_issue_comments,
            issues::create_issue_comment,
            issues::list_issue_activities,
            issues::add_issue_child,
            issues::list_issue_tracker_links,
            issues::add_issue_tracker_link,
            issues::remove_issue_tracker_link,
            issues::update_sprint,
            issues::archive_sprint,
            issues::delete_planning_tag,
            issues::delete_checklist,
            issues::delete_checklist_item,
            issues::delete_time_tracking_entry,
            issues::remove_issue_link,
            chat::list_channels,
            chat::get_channel,
            chat::private_feed,
            chat::get_channel_notification_preference,
            chat::save_channel_notification_preference,
            chat::list_channels_with_meta,
            chat::list_unread_threads,
            chat::create_channel,
            chat::update_channel,
            chat::delete_channel,
            chat::join_channel,
            chat::leave_channel,
            chat::add_channel_member,
            chat::remove_channel_member,
            chat::list_channel_members,
            chat::create_entity_channel,
            chat::get_channel_by_entity,
            chat::resolve_source_ref,
            chat::ensure_thread_channel,
            chat::list_messages,
            chat::list_pinned_messages,
            chat::list_thread_replies,
            chat::create_message,
            chat::add_message_attachment,
            chat::set_message_attachment_state,
            chat::remove_message_attachment,
            chat::update_message,
            chat::set_message_pinned,
            chat::save_message_draft,
            chat::get_message_draft,
            chat::list_message_drafts,
            chat::delete_message_draft,
            chat::set_channel_typing,
            chat::list_channel_typing,
            chat::schedule_message,
            chat::list_scheduled_messages,
            chat::get_scheduled_message,
            chat::update_scheduled_message,
            chat::cancel_scheduled_message,
            chat::deliver_due_scheduled_messages,
            chat::create_poll,
            chat::get_poll,
            chat::list_channel_polls,
            chat::vote_poll,
            chat::close_poll,
            chat::list_messages_page,
            chat::unfurl_message_links,
            chat::list_mentions_for_profile,
            chat::count_unread_mentions,
            chat::delete_message,
            chat::add_reaction,
            chat::remove_reaction,
            chat::mark_channel_read,
            channel_feeds::save_channel_subscription,
            channel_feeds::list_channel_subscriptions,
            review::list_reviews,
            review::list_external_issue_links,
            review::create_external_issue_link,
            review::delete_external_issue_link,
            review::get_review,
            review::update_review,
            review::list_review_participants,
            review::review_aggregated_status,
            review::list_owned_review_files,
            review::list_review_file_states,
            review::save_review_file_state,
            review::add_review_participant,
            review::set_participant_state,
            review::open_merge_request,
            review::review_diff,
            review::list_review_discussions,
            review::create_review_discussion,
            review::set_discussion_resolved,
            review::set_suggested_edit_status,
            review::apply_suggested_edit,
            review::list_protected_branch_rules,
            review::save_merge_preferences,
            review::get_merge_policy,
            review::save_merge_policy,
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
            review::create_review,
            documents::list_documents,
            documents::get_document,
            documents::list_favorite_documents,
            documents::set_document_favorite,
            documents::move_favorite_document,
            documents::ensure_project_document_root,
            documents::ensure_organization_library_root,
            documents::create_document,
            documents::update_document,
            documents::move_document,
            documents::archive_document,
            documents::export_document_file,
            chat::stage_message_attachment,
            documents::delete_document,
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
            documents::list_book_owners,
            documents::search_book_documents,
            documents::update_book_access,
            documents::list_document_folders,
            documents::create_document_folder,
            documents::update_document_folder,
            documents::move_document_folder,
            documents::delete_document_folder,
            documents::attach_document_discussion,
            documents::get_document_discussion,
            meetings::list_meetings,
            meetings::get_meeting,
            meetings::create_meeting,
            meetings::update_meeting,
            meetings::archive_meeting,
            meetings::delete_meeting,
            meetings::attach_meeting_channel,
            meetings::list_meeting_rooms,
            meetings::save_meeting_room,
            meetings::reserve_meeting_room,
            meetings::meeting_availability,
            meetings::list_meeting_participants,
            meetings::invite_meeting_participant,
            meetings::set_meeting_participant_status,
            meetings::expand_meeting_occurrences,
            meetings::expand_meeting_occurrences_scoped,
            availability::list_busy_blocks,
            availability::check_meeting_conflicts,
            availability::suggest_meeting_slots,
            calls::start_livekit_server,
            calls::livekit_server_status,
            calls::join_meeting_call,
            calls::end_meeting_call,
            calls::start_meeting_recording,
            calls::stop_meeting_recording,
            calls::list_meeting_recordings,
            calls::list_meeting_transcript_segments,
            calls::append_manual_transcript_segment,
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
            pipelines::list_jobs,
            pipelines::list_job_runs,
            personal::list_todos,
            personal::list_project_todos,
            personal::list_team_todos,
            personal::list_project_member_ids,
            personal::calendar_aggregate,
            personal::create_todo,
            personal::update_todo,
            personal::set_todo_completion,
            personal::postpone_todo,
            personal::convert_todo_to_issue,
            personal::delete_todo,
            channel_notes::list_channel_notes,
            channel_notes::create_channel_note,
            channel_notes::update_channel_note,
            channel_notes::delete_channel_note,
            finance::finance_access_check,
            finance::list_finance_access,
            finance::grant_finance_access,
            finance::revoke_finance_access,
            finance::list_finance_entries,
            finance::create_finance_entry,
            finance::update_finance_entry,
            finance::delete_finance_entry,
            finance::list_finance_plan,
            finance::upsert_finance_plan,
            finance::delete_finance_plan,
            finance::seed_finance_plan,
            finance::import_finance_plan,
            finance::import_splitwise_csv,
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
            personal::get_calendar_options,
            personal::set_calendar_options,
            personal::list_subscription_scopes,
            personal::save_subscription_scope,
            personal::delete_subscription_scope,
            personal::save_subscription_setting,
            personal::delete_subscription_setting,
            personal::goto_search,
            personal::full_text_search,
            personal::dashboard_aggregate,
            personal::project_dashboard_aggregate,
            personal::list_follows,
            personal::save_follow,
            personal::delete_follow,
            personal::list_subscription_deliveries,
            personal::save_subscription_delivery,
            personal::delete_subscription_delivery,
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

#[cfg(test)]
mod command_registration_tests {
    /// Every `#[tauri::command]` must appear in the desktop `invoke_handler`.
    ///
    /// A command can carry its attribute, be dispatched by the web transport, and
    /// still be absent here — and then it fails ONLY at runtime, ONLY on the
    /// desktop, and ONLY when a person tries to use it. This repo shipped that bug
    /// three times before anyone noticed: `get_issue_detail` (the ticket detail pane
    /// never opened on desktop), `delete_meeting`, and — worst — `create_project`
    /// and `update_project`, so the desktop app could not create a project at all.
    ///
    /// The list is read from the sources rather than from a hand-kept copy: a
    /// hand-kept copy is the same mistake one level up.
    #[test]
    fn every_desktop_command_is_registered() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let lib = std::fs::read_to_string(dir.join("lib.rs")).expect("lib.rs");
        let mut missing: Vec<String> = Vec::new();
        for entry in std::fs::read_dir(&dir).expect("src") {
            let path = entry.expect("entry").path();
            let stem = match path.file_stem().and_then(|s| s.to_str()) {
                Some(stem) if path.extension().and_then(|e| e.to_str()) == Some("rs") => {
                    stem.to_string()
                }
                _ => continue,
            };
            if stem == "lib" || stem == "main" {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("module source");
            let mut lines = source.lines().peekable();
            while let Some(line) = lines.next() {
                if !line
                    .trim_start()
                    .starts_with("#[cfg_attr(feature = \"desktop\", tauri::command)]")
                {
                    continue;
                }
                // Skip doc comments and attributes between the marker and the fn.
                let name = loop {
                    match lines.next() {
                        Some(next) => {
                            let next = next.trim_start();
                            if next.starts_with("///") || next.starts_with("#[") {
                                continue;
                            }
                            break next.strip_prefix("pub fn ").map(|rest| {
                                rest.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                                    .next()
                                    .unwrap_or("")
                                    .to_string()
                            });
                        }
                        None => break None,
                    }
                };
                if let Some(name) = name.filter(|n| !n.is_empty()) {
                    if !lib.contains(&format!("{stem}::{name},")) {
                        missing.push(format!("{stem}::{name}"));
                    }
                }
            }
        }
        missing.sort();
        assert!(
            missing.is_empty(),
            "these commands exist but the desktop handler never lists them, so they fail only at runtime: {missing:#?}"
        );
    }
}
