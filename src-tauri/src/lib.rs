pub mod chat;
pub mod db;
#[cfg(feature = "desktop")]
mod debug_server;
pub mod documents;
pub mod git;
pub mod issues;
pub mod meetings;
pub mod calls;
pub mod pipelines;
pub mod platform;
pub mod personal;
pub mod review;

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

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
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
            platform::get_profile,
            platform::create_profile,
            platform::update_profile,
            platform::list_teams,
            platform::get_team,
            platform::create_team,
            platform::update_team,
            platform::archive_team,
            platform::list_team_memberships,
            platform::add_team_membership,
            platform::update_team_membership,
            platform::remove_team_membership,
            platform::list_projects,
            platform::get_project,
            platform::create_project,
            platform::update_project,
            platform::list_roles,
            platform::get_role,
            platform::create_role,
            platform::update_role,
            platform::archive_role,
            platform::list_rights,
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
            issues::get_issue,
            issues::create_issue,
            issues::update_issue,
            issues::list_issue_statuses,
            issues::list_boards,
            issues::list_sprints,
            issues::archive_issue,
            issues::get_issue_detail,
            issues::create_issue_status,
            issues::update_issue_status,
            issues::delete_issue_status,
            issues::create_board,
            issues::update_board,
            issues::delete_board,
            issues::list_board_columns,
            issues::save_board_column,
            issues::delete_board_column,
            issues::move_issue_on_board,
            issues::list_board_issues,
            issues::list_backlog_issues,
            issues::remove_issue_from_board,
            issues::create_sprint,
            issues::update_sprint,
            issues::launch_sprint,
            issues::close_sprint,
            issues::archive_sprint,
            issues::delete_sprint,
            issues::list_swimlanes,
            issues::save_swimlane,
            issues::delete_swimlane,
            issues::list_planning_tags,
            issues::save_planning_tag,
            issues::delete_planning_tag,
            issues::set_issue_tags,
            issues::list_checklists,
            issues::save_checklist,
            issues::delete_checklist,
            issues::list_checklist_items,
            issues::save_checklist_item,
            issues::toggle_checklist_item,
            issues::delete_checklist_item,
            issues::list_time_tracking_entries,
            issues::save_time_tracking_entry,
            issues::delete_time_tracking_entry,
            issues::issue_time_total,
            issues::add_issue_child,
            issues::remove_issue_link,
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
            chat::update_message,
            chat::delete_message,
            chat::add_reaction,
            chat::remove_reaction,
            chat::mark_channel_read,
            review::list_reviews,
            review::get_review,
            review::create_review,
            review::update_review,
            review::list_review_participants,
            review::add_review_participant,
            review::set_participant_state,
            review::open_merge_request,
            review::review_diff,
            review::list_review_discussions,
            review::create_review_discussion,
            review::set_discussion_resolved,
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
            documents::list_doc_versions,
            documents::restore_doc_version,
            documents::list_document_folders,
            documents::create_document_folder,
            documents::update_document_folder,
            documents::move_document_folder,
            meetings::list_meetings,
            meetings::get_meeting,
            meetings::create_meeting,
            meetings::update_meeting,
            meetings::archive_meeting,
            meetings::list_meeting_participants,
            meetings::invite_meeting_participant,
            meetings::set_meeting_participant_status,
            meetings::expand_meeting_occurrences,
            calls::start_livekit_server,
            calls::livekit_server_status,
            calls::join_meeting_call,
            pipelines::list_pipeline_scripts,
            pipelines::create_pipeline_script,
            pipelines::update_pipeline_script,
            pipelines::delete_pipeline_script,
            pipelines::list_jobs,
            pipelines::list_jobs_for_script,
            pipelines::list_job_runs,
            pipelines::list_job_runs_for_script,
            pipelines::trigger_pipeline_script,
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
            pipelines::publish_package_version,
            pipelines::delete_package_version,
            personal::list_todos,
            personal::list_project_todos,
            personal::create_todo,
            personal::update_todo,
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
            personal::save_subscription_setting,
            personal::delete_subscription_setting,
            personal::goto_search,
            personal::dashboard_aggregate,
        ])
        .setup(|app| {
            let conn = db::connection(app.handle()).map_err(|e| std::io::Error::other(e))?;
            db::seed(&conn).map_err(|e| std::io::Error::other(e.to_string()))?;
            // Built manually (instead of via tauri.conf.json's `app.windows`) so we
            // can attach the debug-server's console-capture init script before the
            // page ever loads. See src/debug_server.rs + skills/app-tools.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("GAIA Space")
                .inner_size(800.0, 600.0)
                .min_inner_size(480.0, 360.0)
                .resizable(true)
                .initialization_script(&debug_server::init_script())
                .build()?;
            debug_server::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
