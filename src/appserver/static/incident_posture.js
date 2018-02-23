require.config({
    paths: {
        "app": "../app"
    },
    shim: {
        "select2": {
            deps: ['jquery', 'css!../select2/css/select2.min.css'],
            exports: "Select2"
        },
    }
});

require([
    "splunkjs/mvc",
    "splunkjs/mvc/utils",
    "splunkjs/mvc/tokenutils",
    "underscore",
    "jquery",
    'app/alert_manager/contrib/select2/js/select2.min',
    'models/SplunkDBase',
    'splunkjs/mvc/sharedmodels',
    "splunkjs/mvc/simplexml",
    'splunkjs/mvc/tableview',
    'splunkjs/mvc/chartview',
    'splunkjs/mvc/searchmanager',
    'splunk.util',
    'app/alert_manager/views/single_trend',
    'splunkjs/mvc/simplexml/element/single',
    'util/moment'
], function(
        mvc,
        utils,
        TokenUtils,
        _,
        $,
        select2,
        SplunkDModel,
        sharedModels,
        DashboardController,
        TableView,
        ChartView,
        SearchManager,
        splunkUtil,
        SingleElement,
        TrendIndicator,
        moment
    ) {

    // Tokens
    var submittedTokens = mvc.Components.getInstance('submitted', {create: true});
    var defaultTokens   = mvc.Components.getInstance('default', {create: true});

    // Tracker num used to create unique id names for display elements/tableview objects/searchmanager objects
    var tracker_num = 0

    var CustomConfModel = SplunkDModel.extend({
        urlRoot: 'configs/conf-alert_manager'
    });
    var settings = new CustomConfModel();
    settings.set('id', 'settings');
    var app = sharedModels.get('app');

    settings.fetch({
        data: {
            app: app.get('app'),
            owner: app.get('owner')
        }
    }).done(function(){
        var incident_list_length = settings.entry.content.get('incident_list_length');
        defaultTokens.set('incident_list_length', incident_list_length);
        submittedTokens.set('incident_list_length', incident_list_length);
    });

    var search_recent_alerts = mvc.Components.get('recent_alerts');
    search_recent_alerts.on("search:progress", function(properties) {
        var props = search_recent_alerts.job.properties();
        if (props.searchEarliestTime != undefined && props.searchLatestTime != undefined) {
            earliest  = props.searchEarliestTime;
            latest    = props.searchLatestTime;
            interval  = latest - earliest;
            trend_earliest = earliest - interval;
            trend_latest = earliest;

            if((defaultTokens.get('trend_earliest') == undefined || defaultTokens.get('trend_earliest') != trend_earliest) && (defaultTokens.get('trend_latest') == undefined || defaultTokens.get('trend_latest') != latest)) {
                defaultTokens.set('trend_earliest', trend_earliest);
                defaultTokens.set('trend_latest', trend_latest);
                submittedTokens.set(defaultTokens.toJSON());
            }
        }
    });


    var IconRenderer = TableView.BaseCellRenderer.extend({
        canRender: function(cell) {
            // Only use the cell renderer for the specific field
            return (cell.field==="dosearch" || cell.field==="doedit" || cell.field == "owner" || cell.field == "doquickassign" || cell.field == "doexternalworkflowaction");
        },
        render: function($td, cell) {
            if(cell.field=="owner") {
                if(cell.value!="unassigned") {
                    icon = 'user';
                    $td.addClass(cell.field).addClass('icon-inline').html(_.template('<i class="icon-<%-icon%>" style="padding-right: 2px"></i><%- text %>', {
                        icon: icon,
                        text: cell.value
                    }));
                } else {
                    $td.addClass(cell.field).html(cell.value);
                }
            } else {
                if(cell.field=="dosearch") {
                    var icon = 'search';
                } else if (cell.field=="doedit") {
                    var icon = 'list';
                } else if (cell.field=="doquickassign") {
                    var icon = 'user';
                } else if (cell.field=="doexternalworkflowaction") {
                    var icon = 'external';
                }

                var rendercontent='<div style="float:left; max-height:22px; margin:0px;"><i class="icon-<%-icon%>" >&nbsp;</i></div>';

                $td.addClass('table_inline_icon').html(_.template(rendercontent, {
                    icon: icon
                }));

                $td.on("click", function(e) {
                    console.log("event handler fired");
                    e.stopPropagation();
                    $td.trigger("iconclick", {"field": cell.field });
                });
            }
        }
    });

    var HiddenCellRenderer = TableView.BaseCellRenderer.extend({
        canRender: function(cell) {
            // Only use the cell renderer for the specific field
            return (cell.field==="alert" || cell.field==="incident_id" || cell.field==="job_id" || cell.field==="result_id"
                 || cell.field==="status"  || cell.field==="alert_time" || cell.field==="display_fields"
                 || cell.field==="search" || cell.field==="event_search" || cell.field==="earliest"
                 || cell.field==="latest" || cell.field==="impact" || cell.field==="urgency" || cell.field==="app" || cell.field==="alert");
        },
        render: function($td, cell) {
            // ADD class to cell -> CSS
            $td.addClass(cell.field).html(cell.value);
        }
    });

     // Row Coloring Example with custom, client-side range interpretation
    var ColorRenderer = TableView.BaseCellRenderer.extend({
        canRender: function(cell) {
            // Enable this custom cell renderer for both the active_hist_searches and the active_realtime_searches field
            return _(['priority']).contains(cell.field);
        },
        render: function($td, cell) {
            // Add a class to the cell based on the returned value
            var value = cell.value;
            // Apply interpretation for number of historical searches
            if (cell.field === 'priority') {
                if (value == "informational") {
                    $td.addClass('range-cell').addClass('range-info');
                }
                else if (value == "low") {
                    $td.addClass('range-cell').addClass('range-low');
                }
                else if (value == "medium") {
                    $td.addClass('range-cell').addClass('range-medium');
                }
                else if (value == "high") {
                    $td.addClass('range-cell').addClass('range-high');
                }
                else if (value == "critical") {
                    $td.addClass('range-cell').addClass('range-critical');
                }
                else if (value == "unknown") {
                    $td.addClass('range-cell').addClass('range-unknown');
                }
            }

            // Update the cell content
            //$td.text(value.toFixed(2)).addClass('numeric');
            $td.text(value);
        }
    });


    var IncidentDetailsExpansionRenderer = TableView.BaseRowExpansionRenderer.extend({
        initialize: function(args) {
            // initialize will run once, so we will set up a search and a chart to be reused.
            this._historySearchManager = new SearchManager({
                id: 'incident_history_exp_manager',
                preview: false
            });
            this._historyTableView = new TableView({
                id: 'incident_history_exp',
                managerid: 'incident_history_exp_manager',
                'drilldown': 'none',
                'wrap': true,
                'displayRowNumbers': true,
                'pageSize': '50'
            });

            this._detailsSearchManager = new SearchManager({
                id: 'incident_details_exp_manager',
                preview: false
            });
           /* Moved this below to have new tableviews regenerated on every incident detail display. Probably a lack of
           development knowledge with splunkjs (john landers), but this was the only way I could ensure my custom drilldown
           functionality would work consistently.

            this._detailsTableView = new TableView({
                id: 'incident_details_exp',
                managerid: 'incident_details_exp_manager',
                'drilldown': 'row',
                'wrap': true,
                'displayRowNumbers': true,
                'pageSize': '50'
            });
            */

        },
        canRender: function(rowData) {
            return true;
        },
        render: function($container, rowData) {

            var incident_id = _(rowData.cells).find(function (cell) {
               return cell.field === 'incident_id';
            });

            var job_id = _(rowData.cells).find(function (cell) {
               return cell.field === 'job_id';
            });

            var result_id = _(rowData.cells).find(function (cell) {
               return cell.field === 'result_id';
            });

            var alert_time = _(rowData.cells).find(function (cell) {
               return cell.field === 'alert_time';
            });

            var impact = _(rowData.cells).find(function (cell) {
               return cell.field === 'impact';
            });

            var urgency = _(rowData.cells).find(function (cell) {
               return cell.field === 'urgency';
            });

            var alert = _(rowData.cells).find(function (cell) {
               return cell.field === 'alert';
            });

            var app = _(rowData.cells).find(function (cell) {
               return cell.field === 'app';
            });

            var display_fields = _(rowData.cells).find(function (cell) {
               return cell.field === 'display_fields';
            });

            console.debug("display_fields", display_fields.value);

            $("<h3 />").text('Details').appendTo($container);


            var contEl = $('<div />').attr('id','incident_details_exp_container');
            contEl.append($('<div />').css('float', 'left').text('incident_id=').append($('<span />').attr('id','incident_id_exp_container').addClass('incidentid').text(incident_id.value)));
            contEl.append($('<div />').css('float', 'left').text('impact=').append($('<span />').addClass('incident_details_exp').addClass('exp-impact').addClass(impact.value).text(impact.value)));
            contEl.append($('<div />').text('urgency=').append($('<span />').addClass('incident_details_exp').addClass('exp-urgency').addClass(urgency.value).text(urgency.value)));
            contEl.appendTo($container)

            // John Landers: Added a loading bar for when the search load takes too long
            $("<div/>").text('Loading...').attr('id', 'loading-bar-details').appendTo($container);

            // John Landers: Made the definition of display fields optional. Requries an additional incident_details(1) macro be created
            if (display_fields.value != null && display_fields.value != "" && display_fields.value != " ") {
                var search_string = '| `incident_details('+incident_id.value +', "'+ display_fields.value +'")`'
            } else {
                var search_string = '| `incident_details('+incident_id.value +')`'
            }

            console.debug("search_string:", search_string)
            console.debug("alert_time:",alert_time.value)
            console.debug("earliest:",parseInt(alert_time.value)-600)
            console.debug("latest:", parseInt(alert_time.value)+600)

            // John Landers: Modified search times all around to handle variation in alert_time verse index_time
            // this is important if you switch result loading from KV store to indexed data
            $("<br />").appendTo($container);
            this._detailsSearchManager.set({
                search: search_string,
                earliest_time: parseInt(alert_time.value)-600,
                latest_time: parseInt(alert_time.value)+600
            });


            // John Landers: Every time a drilldown is initiated, I create a whole new tableview object.
            // Not sure if this is a good way to do this but it allowed me to ensure, 100%, that my custom drilldown
            // action was respected every time
            tracker_num=tracker_num+1
            console.log('drilldown for ' + incident_id.value)
            this._detailsTableView = new TableView({
                id: 'incident_details_exp_'+incident_id.value+'_'+tracker_num,
                managerid: 'incident_details_exp_manager',
                'drilldown': 'row',
                'wrap': true,
                'displayRowNumbers': true,
                'pageSize': '50'
            });

            $container.append(this._detailsTableView.render().el);
            this._detailsSearchManager.on("search:done", function(state, job){
                $("#loading-bar-details").hide();
            });

            $("<br />").appendTo($container);

            // John Landers: I create this empty container to ensure drilldown contents are displayed
            // in a consistent location every time.
            $('<div>').text('').attr('id', 'drilldown-replacement-div_'+incident_id.value+'_'+tracker_num).appendTo($container);


            // John Landers: capture clicks on the incident details table and do stuff
            this._detailsTableView.on("click", function(e) {
                // prevent default drilldown actions
                e.preventDefault();

                // jl: <3 debug logging.
                console.log("Click captured. key=", e.data['row.Key'], "; value=", e.data['row.Value']);

                // jl: We use this to query the KV store for drilldown searches providing the key/value pair for replacement
                var url = splunkUtil.make_url('/custom/alert_manager/helpers/get_drilldown_search?field='+e.data['row.Key']+'&value='+e.data['row.Value']);

                // we need to check here if the clicky has already been made. if so, skip subsequent clicks...
                $("#drilldown-replacement-div_"+incident_id.value+'_'+tracker_num).each(function() {
                  if($(this).html().indexOf('<h3>Drilldown Results for field "' + e.data['row.Key'] + '"</h3>') > -1) {
                     console.log("This click was made before. Skipping.")

                  } else {
                    // jl: get the search from our custom helper and then run it.
                    console.log("Row was not clicked before. Getting searches.")

                    $.getJSON( url,function(rd) {
                        var managers=[]
                        // jl: loop through the returned array
                        for (var i=0,len=rd.length;i<len;i++) {
                            console.log("i: "+i)
                            // jl: if nothing is returned or the value returned is 'not_found', do not search
                            if (rd[i] != '' && rd[i] != 'not_found') {
                                console.log("Returned data: ", rd[i])

                                var myhtml='<h3>Drilldown Results for field "' + e.data['row.Key'] + '"</h3>'
                                myhtml += '<div id="drilldown-loader-' +incident_id.value+'_'+tracker_num+'_'+i +'"></div><br />'
                                $("#drilldown-replacement-div_"+incident_id.value+'_'+tracker_num).append(myhtml)

                                // jl: create a unique search manager for each drilldown search and run it.
                                // There is probably a better way to do this.
                                managers[i] = new SearchManager({
                                        id: 'incident_drilldown_exp_manager_'+incident_id.value+'_'+tracker_num+'_'+i,
                                        preview: false,
                                        autostart: false,
                                        search: rd[i],
                                        earliest_time: parseInt(alert_time.value)-600,
                                        latest_time: 'now'
                                    });

                                managers[i].startSearch();

                            } else {
                                var myhtml='<h3>Drilldown Results for field "' + e.data['row.Key'] + '"</h3>'
                                myhtml += '<b>No active drilldown search found for this field.</b><br /><br />'
                                $("#drilldown-replacement-div_"+incident_id.value+'_'+tracker_num).append(myhtml);
                            }
                        }

                        console.log(managers.length+" entries found.")
                        var tables = []
                        // jl: for each search manager, we need to look for the search:done status to display results
                        $.each(managers, function(index,value) {
                            value.on("search:done", function(state, job){
                                tables[index] = new TableView({
                                    id: 'incident_drilldown_exp_'+incident_id.value+'_'+tracker_num+'_'+index,
                                    managerid: 'incident_drilldown_exp_manager_'+incident_id.value+'_'+tracker_num+'_'+index,
                                    'drilldown': 'none',
                                    'wrap': true,
                                    'displayRowNumbers': true,
                                    'pageSize': '20',
                                    'el': $("#drilldown-loader-"+incident_id.value+'_'+tracker_num+'_'+index)
                                }).render();
                            });
                        });
                    });

                  }

                });
            });

            $('<br />').appendTo($container);

            var url = splunkUtil.make_url('/custom/alert_manager/helpers/get_savedsearch_description?savedsearch='+alert.value+'&app='+app.value);
            var desc = "";
            $.get( url,function(data) {
                desc = data;
                if (desc != "") {
                    $("<br />").appendTo($container);
                    $("<h3 />").text('Alert Description').appendTo($container);
                    $("<div />").attr('id','incident_details_description').addClass('incident_details_description').appendTo($container);
                    $("<br />").appendTo($container);
                    $("#incident_details_description").html(data);
                }
            });

            $("<h3>").text('History').appendTo($container);
            $("<div/>").text('Loading...').attr('id', 'loading-bar').appendTo($container);
            this._historySearchManager.set({
                search: '| `incident_history('+ incident_id.value +')`',
                earliest_time: parseInt(alert_time.value)-600,
                latest_time: 'now'
            });
            $container.append(this._historyTableView.render().el);
            this._historySearchManager.on("search:done", function(state, job){
                $("#loading-bar").hide();
            });
        }
    });

    incidentsOverViewTable = mvc.Components.get('incident_overview');
    incidentsOverViewTable.getVisualization(function(tableView) {
        // Add custom cell renderer
        tableView.table.addCellRenderer(new ColorRenderer());
        tableView.table.addCellRenderer(new HiddenCellRenderer());
        tableView.table.addCellRenderer(new IconRenderer());
        tableView.addRowExpansionRenderer(new IncidentDetailsExpansionRenderer());

        tableView.table.render();

    });

    var rendered = false;
    incidentsOverViewTable.on("rendered", function(obj) {
        if (settings.entry.content.get('incident_list_length') != undefined) {
            if(rendered == false) {
                rendered = true;
                obj.settings.set({ pageSize: settings.entry.content.get('incident_list_length') });
            }
        }
    });

    $(document).on("iconclick", "td", function(e, data) {

        // Displays a data object in the console

        console.log("field", data);

        if (data.field=="dobla1") {
            // Drilldown panel (loadjob)
            drilldown_job_id=($(this).parent().find("td.job_id")[0].innerHTML);
            submittedTokens.set("drilldown_job_id", drilldown_job_id);
            $(alert_details).parent().parent().parent().show();
        }
        else if (data.field=="dosearch"){
            // Drilldown search (search view)
            var drilldown_search=($(this).parent().find("td.search")[0].innerHTML);
            var drilldown_search_earliest=($(this).parent().find("td.earliest")[0].innerHTML);
            var drilldown_search_latest=($(this).parent().find("td.latest")[0].innerHTML);
            var drilldown_app=($(this).parent().find("td.app")[0].innerHTML);

            // Set default app to search if cannot be evaluated
            if (drilldown_app == undefined || drilldown_app == "") {
                drilldown_app = "search";
            }

            drilldown_search = drilldown_search.replace("&gt;",">").replace("&lt;","<");
            drilldown_search = encodeURIComponent(drilldown_search);

            var search_url="search?q="+drilldown_search+"&earliest="+drilldown_search_earliest+"&latest="+drilldown_search_latest;
            var url = splunkUtil.make_url('/app/' + drilldown_app + '/' + search_url);

            window.open(url,'_search');

        }
        else if (data.field=="doquickassign") {
            var incident_id =   $(this).parent().find("td.incident_id").get(0).textContent;
            var urgency = $(this).parent().find("td.urgency").get(0).textContent;
            var status = "assigned";
            var comment = "Assigning for review."
            var owner=Splunk.util.getConfigValue("USERNAME");

            console.debug("Username: ", owner)
            var update_entry = { 'incident_id': incident_id, 'owner': owner, 'urgency': urgency, 'status': status, 'comment': comment };
            console.debug("entry", update_entry);
            //debugger;
            data = JSON.stringify(update_entry);
            var post_data = {
                contents    : data
            };

            var url = splunkUtil.make_url('/custom/alert_manager/incident_workflow/save');
            console.debug("url", url);

            $.ajax( url,
                {
                    uri:  url,
                    type: 'POST',
                    data: post_data,
                    
                    success: function(jqXHR, textStatus){
                        // Reload the table                        
                        mvc.Components.get("recent_alerts").startSearch();
                        console.debug("success");
                    },
                    
                    // Handle cases where the file could not be found or the user did not have permissions
                    complete: function(jqXHR, textStatus){
                        console.debug("complete");
                    },
                    
                    error: function(jqXHR,textStatus,errorThrown) {
                        console.log("Error");
                    } 
                }
            );
        }
        else if (data.field=="doedit"){
            console.log("doedit catched");
            // Incident settings
            var incident_id =   $(this).parent().find("td.incident_id").get(0).textContent;
            var owner =    $(this).parent().find("td.owner").get(0).textContent;
            var urgency = $(this).parent().find("td.urgency").get(0).textContent;
            var status =   $(this).parent().find("td.status").get(0).textContent;

            var status_ready = false;
            var owner_ready = false;

            var edit_panel='' +
'<div class="modal fade modal-wide shared-alertcontrols-dialogs-editdialog in" id="edit_panel">' +
'    <div class="modal-content">' +
'      <div class="modal-header">' +
'        <button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>' +
'        <h4 class="modal-title" id="exampleModalLabel">Edit Incident</h4>' +
'      </div>' +
'      <div class="modal-body modal-body-scrolling">' +
'        <div class="form form-horizontal form-complex" style="display: block;">' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="incident_id" class="control-label">Incident:</label>' +
'            <div class="controls controls-block"><div class="control shared-controls-labelcontrol" id="incident_id"><span class="input-label-incident_id">' + incident_id + '</span></div></div>' +
'          </div>' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="message-text" class="control-label">Urgency:</label>' +
'            <div class="controls"><select name="urgency" id="urgency" disabled="disabled"></select></div>' +
'          </div>' +
'          <p class="control-heading">Incident Workflow</p>'+
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="recipient-name" class="control-label">Owner:</label>' +
'            <div class="controls"><select name="owner" id="owner" disabled="disabled"></select></div>' +
'          </div>' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="message-text" class="control-label">Status:</label>' +
'            <div class="controls"><select name="status" id="status" disabled="disabled"></select></div>' +
'          </div>' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="message-text" class="control-label">Comment:</label>' +
'            <div class="controls"><textarea type="text" name="comment" id="comment" class=""></textarea></div>' +
'          </div>' +
'        </div>' +
'      </div>' +
'      <div class="modal-footer">' +
'        <button type="button" class="btn cancel modal-btn-cancel pull-left" data-dismiss="modal">Cancel</button>' +
'        <button type="button" class="btn btn-primary" id="modal-save" disabled>Save</button>' +
'      </div>' +
'    </div>' +
'</div>';
            $('body').prepend(edit_panel);

            // Get list of users and prepare dropdown
            $("#owner").select2();
            var url = splunkUtil.make_url('/custom/alert_manager/helpers/get_users');
            var owner_xhr = $.get( url,function(data) {

                var users = new Array();
                users.push("unassigned");

                _.each(data, function(el) {
                    users.push(el.name);
                });

                _.each(users, function(user) {
                    if (user == owner) {
                        $('#owner').append( $('<option></option>').attr("selected", "selected").val(user).html(user) )
                        $('#owner').select2('data', {id: user, text: user});
                    } else {
                        $('#owner').append( $('<option></option>').val(user).html(user) )
                    }
                });
                $("#owner").prop("disabled", false);
                owner_ready = true;
                $("body").trigger({type: "ready_change" });
            }, "json");

            var all_urgencies = [ "low" ,"medium", "high" ]
            $.each(all_urgencies, function(key, val) {
                if (val == urgency) {
                    $('#urgency').append( $('<option></option>').attr("selected", "selected").val(val).html(val) )
                } else {
                    $('#urgency').append( $('<option></option>').val(val).html(val) )
                }
                $("#urgency").prop("disabled", false);
            }); //

            // John Landers: Modified how the alert status list is handled; now pulls from KV store
            var status_url = splunkUtil.make_url('/custom/alert_manager/helpers/get_status_list');
            var status_xhr = $.get( status_url, function(data) {
               if (status == "auto_assigned") { status = "assigned"; }

               _.each(data, function(val, text) {
                    if (val['status'] == status) {
                        $('#status').append( $('<option></option>').attr("selected", "selected").val(val['status']).html(val['status_description']) )
                    } else {
                        $('#status').append( $('<option></option>').val(val['status']).html(val['status_description']) )
                    }
                    $("#status").prop("disabled", false);
                });

            }, "json");

            // Wait for owner and status to be ready
            $.when(status_xhr, owner_xhr).done(function() {
              console.log("status and owner are ready");
              $('#modal-save').prop('disabled', false);
            });

            // Change status when new owner is selected
            $('#owner').on("change", function() {
                if($( this ).val() == "unassigned") {
                    $('#status').val('new');
                } else {
                    $('#status').val('assigned');
                }
            });

            // Finally show modal
            $('#edit_panel').modal('show');
        }

        else if (data.field=="doexternalworkflowaction"){
            console.log("doexternalworkflowaction catched");
            // Incident settings
            var incident_id = $(this).parent().find("td.incident_id").get(0).textContent;

            var externalworkflowaction_panel='' +
'<div class="modal fade modal-wide shared-alertcontrols-dialogs-externalworkflowactiondialog in" id="externalworkflowaction_panel">' +
'    <div class="modal-content">' +
'      <div class="modal-header">' +
'        <button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>' +
'        <h4 class="modal-title" id="exampleModalLabel">Execute External Workflow Action</h4>' +
'      </div>' +
'      <div class="modal-body modal-body-scrolling">' +
'        <div class="form form-horizontal form-complex" style="display: block;">' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="incident_id" class="control-label">Incident:</label>' +
'            <div class="controls controls-block"><div class="control shared-controls-labelcontrol" id="incident_id"><span class="input-label-incident_id">' + incident_id + '</span></div></div>' +
'          </div>' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="message-text" class="control-label">Select Action:</label>' +
'            <div class="controls"><select name="externalworkflowaction" id="externalworkflowaction" disabled="disabled"></select></div>' +
'          </div>' +
'          <div class="control-group shared-controls-controlgroup">' +
'            <label for="message-text" class="control-label">Command:</label>' +
'            <div class="controls"><textarea type="text" name="externalworkflowaction_command" id="externalworkflowaction_command" class=""></textarea></div>' +
'          </div>' +
'        </div>' +
'      </div>' +
'      <div class="modal-footer">' +
'        <button type="button" class="btn cancel modal-btn-cancel pull-left" data-dismiss="modal">Cancel</button>' +
'        <button type="button" class="btn btn-primary" id="modal-execute" disabled>Execute</button>' +
'      </div>' +
'    </div>' +
'</div>';

            $('body').prepend(externalworkflowaction_panel);
 
            $('#externalworkflowaction').append('<option value="-">-</option>');


            var externalworkflowaction_url = splunkUtil.make_url('/custom/alert_manager/helpers/get_externalworkflowaction_settings');
            var externalworkflowaction_xhr = $.get( externalworkflowaction_url, function(data) {

               _.each(data, function(val, text) {
                    $('#externalworkflowaction').append( $('<option></option>').val(val['title']).html(val['label']) );
                    $("#externalworkflowaction").prop("disabled", false)
                });

            }, "json");
              


            // Wait for externalworkflowaction to be ready
                $.when(externalworkflowaction_xhr).done(function() {
                console.log("externalworkflowaction is ready");
                $('#modal-execute').prop('disabled', false);
            }); 

	    $('#externalworkflowaction_command').prop('readonly',true);
            
            // Finally show modal
            $('#externalworkflowaction_panel').modal('show');
        }
    });

    $(document).on("click", "#modal-save", function(event){
        // save data here
        var incident_id = $("#incident_id > span").html();
        var owner  = $("#owner").val();
        var urgency  = $("#urgency").val();
        var status  = $("#status").val();
        var comment  = $("#comment").val();

        // John Landers: Added comment == "" to make comments required
        // simcen: Changed back to not require comment
        if(incident_id == "" || owner == "" || urgency == "" || status == "") {
            alert("Please choose a value for all required fields!");
            return false;
        }

        var update_entry = { 'incident_id': incident_id, 'owner': owner, 'urgency': urgency, 'status': status, 'comment': comment };
        console.debug("entry", update_entry);
        //debugger;
        data = JSON.stringify(update_entry);
        var post_data = {
            contents    : data
        };

        var url = splunkUtil.make_url('/custom/alert_manager/incident_workflow/save');
        console.debug("url", url);

        $.ajax( url,
            {
                uri:  url,
                type: 'POST',
                data: post_data,

                success: function(jqXHR, textStatus){
                    // Reload the table
                    mvc.Components.get("recent_alerts").startSearch();
                    mvc.Components.get("base_single_search").startSearch();
                    $('#edit_panel').modal('hide');
                    $('#edit_panel').remove();

                    console.debug("success");
                },

                // Handle cases where the file could not be found or the user did not have permissions
                complete: function(jqXHR, textStatus){
                    console.debug("complete");
                },

                error: function(jqXHR,textStatus,errorThrown) {
                    console.log("Error");
                }
            }
        );

    });


    $(document).on("click", "#externalworkflowaction", function(event){ 
	var incident_id = $("#incident_id > span").html();

        label = $("#externalworkflowaction option:selected").text();
        if (label!="-"){
        	var externalworkflowaction_command_url = splunkUtil.make_url('/custom/alert_manager/helpers/get_externalworkflowaction_command?incident_id='+incident_id+'&externalworkflowaction_label='+label);
		$.get( externalworkflowaction_command_url, function(data, status) { $('#externalworkflowaction_command').val(data); }, "text"); 
	}	

    });


    $(document).on("click", "#modal-execute", function(event){
        var incident_id = $("#incident_id > span").html();
        var command  = $("#externalworkflowaction_command").val();

        if(command == "") {
            alert("Please choose a value for all required fields!");
            return false;
        }
	manager = new SearchManager({
					id: 'externalworkflowaction_' + incident_id +'_' + Date.now(),
                                        preview: false,
                                        autostart: false,
                                        search: command,
                                        earliest_time: '-1m',
                                        latest_time: 'now'
                                    });
        manager.startSearch(); 
	manager = null;

	var log_event_url = splunkUtil.make_url('/custom/alert_manager/helpers/log_action?incident_id='+incident_id+'&origin=externalworkflowaction&comment='+label+' workflowaction executed &action=comment');
	$.get( log_event_url, function(data, status) { return "Executed"; }, "text");

	
        $('#externalworkflowaction_panel').modal('hide');
        $('#externalworkflowaction_panel').remove();
    });

});
