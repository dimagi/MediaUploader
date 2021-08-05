var HQMediaUploaderTypes = {
    'bulk': HQMediaBulkUploadController,
    'file': HQMediaFileUploadController,
};

function BaseHQMediaUploadController (uploader_name, marker, options) {
    'use strict';
    var self = this;

    // These are necessary for having multiple upload controllers on the same page.
    self.container = "#" + uploader_name;
    self.marker = marker + "_";

    ///// YUI Uploader Specific Params
    self.fileFilters = options.fileFilters;
    self.isMultiFileUpload = options.isMultiFileUpload;

    // Essential Selectors
    self.selectFilesButtonContainer = self.container + " .hqm-select-files-container";
    self.selectFilesButton = self.container + " .hqm-select";

    self.uploadButtonSelector = self.container + " .hqm-upload";
    self.confirmUploadSelector = self.container + " .hqm-upload-confirm";

    self.processingFilesListSelector = self.container + " .hqm-upload-processing";
    self.uploadedFilesListSelector = self.container + " .hqm-uploaded-files";
    self.queueSelector = self.container + " .hqm-queue";
    self.uploadFormSelector = self.container + " .hqm-upload-form";

    self.notSupportedNotice = self.container + " .hqm-not-supported";

    // behavior controls
    self.allowCloseDuringUpload = options.allowCloseDuringUpload || false;

    // Templates
    self.queueTemplate = options.queueTemplate;
    self.errorsTemplate = options.errorsTemplate;

    // Stuff for processing the upload
    self.uploadParams = options.uploadParams || {};
    self.licensingParams = options.licensingParams || [];
    self.uploadURL = options.uploadURL;
    self.processingURL = options.processingURL;

    // Polling
    self.pollInterval = 2000;  // 2 sec
    self.maxPollInterval = 20000;  // 20 seconds
    self.currentPollAttempts = 0;
    self.maxPollAttempts = 20;
    self.allowClose = true;

    $(self.container).on('hide.bs.modal', function (event) {
        if (!self.allowClose) {
            event.preventDefault();
        }
    });

    self._getActiveUploadSelectors = function (file) {
        /*
         All the different active parts of the queued item template that the upload controller cares about.
         file is an instance of Y.file
         */
        var selector = '#' + self.marker + file.get('id');
        return {
            selector: selector,
            progressBarContainer: selector + ' .progress',
            progressBar: selector + ' .progress .progress-bar',
            cancel: selector + ' .hqm-cancel',
            remove: selector + ' .hqm-remove',
            beginNotice: selector + ' .hqm-begin',
            processingQueuedNotice: selector + ' .hqm-processing-queued',
            processingNotice: selector + ' .hqm-processing',
            completeNotice: selector + ' .hqm-upload-completed',
            errorNotice: selector + ' .hqm-error',
            status: selector + ' .hqm-status',
            details: selector + ' .hqm-details',
        };
    };

    // templates
    self._processQueueTemplate = function (file) {
        /*
            This renders the template for the queued item display.
         */
        var MEGABYTE = 1048576;
        return _.template(self.queueTemplate)({
            unique_id: self.marker + file.get('id'),
            file_size: (file.get('size')/MEGABYTE).toFixed(3),
            file_name: file.get('name'),
        });
    };



    self._processErrorsTemplate = function (errors) {
        return _.template(self.errorsTemplate)({
            errors: errors,
        });
    };

    // actions
    self._cancelFileUpload = function (file) {
        /*
            What happens when you cancel a file from uploading.
         */
        return function (event) {
            file.cancelUpload();
            self.uploader.queue = null; // https://github.com/yui/yui3/issues/1179#issuecomment-24175982
            var activeSelector = self._getActiveUploadSelectors(file);
            $(activeSelector.progressBar).attr('style', 'width: 0%;');
            $(activeSelector.cancel).addClass('hide');
            $(activeSelector.remove).removeClass('hide');
            event.preventDefault();
            self.allowClose = true;
        };
    };

    self._removeFileFromQueue = function (file) {
        /*
            What happens when you remove a file from the queue
        */
        return function (event) {
            self._removeFileFromUploader(file);
            self._removeFileFromUI(file);
            event.preventDefault();
        };
    };


    // UI related
    self._startUploadUI = function () {
        // optional: set the state of the uploader UI here when the upload starts
    };

    self._removeFileFromUI = function (file) {
        var activeSelectors = self._getActiveUploadSelectors(file);
        $(activeSelectors.selector).remove();
        self._toggleUploadButton();
    };

    self._toggleUploadButton = function () {
        var $uploadButton = $(self.uploadButtonSelector);
        (self.filesInQueueUI.length > 0) ? $uploadButton.addClass('btn-success').removeClass('disabled') : $uploadButton.addClass('disabled').removeClass('btn-success');
    };

    self._activateQueueUI = function () {
        for (var i=0; i < self.filesInQueueUI.length; i++) {
            var queuedFile = self.filesInQueueUI[i];
            var currentSelector = self._getActiveUploadSelectors(queuedFile);
            $(currentSelector.beginNotice).addClass('hide');
            $(currentSelector.remove).addClass('hide');
            $(currentSelector.cancel).removeClass('hide');
        }
    };

    self._resetUploadForm = function () {
        var $uploadForm = $(self.uploadFormSelector);
        $uploadForm.find('.hqm-share-media').prop('checked', false);
        $uploadForm.find('.hqm-sharing').addClass('hide');
        $uploadForm.find('[name="license"]').val('cc');
        $uploadForm.find('[name="author"]').val('');
        $uploadForm.find('[name="attribution-notes"]').val('');
    };

    self.getLicensingParams = function () {
        var $form = $(self.uploadFormSelector),
            params = {};
        for (var i = 0; i < self.licensingParams.length; i++) {
            var param_name = self.licensingParams[i];
            var param_val = $form.find('[name="' + param_name + '"]').val();
            if (param_val.length > 0) params[param_name] = param_val;
        }
        return params;
    };

    // Uploader flow
    self.init = function () {
        /*
            Initialize the YUI uploader.
            Use HTML5 version; flash version wasn't properly triggering fileselect events,
            which are needed for app manager's bulk multimedia uploader.
         */
        YUI().use('uploader', function (Y) {
            var buttonRegion = Y.one(self.selectFilesButton).get('region');
            if (Y.Uploader.TYPE == "none") {
                $(self.notSupportedNotice).removeClass('hide');
                $(self.selectFilesButtonContainer).parent().addClass('hide');
                return;
            } else {
                $(self.notSupportedNotice).remove();
            }

            self.uploader = new Y.Uploader({
                width: buttonRegion.width || '100px',
                height: buttonRegion.height || '35px',
                selectFilesButton: Y.one(self.selectFilesButton),
                multipleFiles: self.isMultiFileUpload,
            });

            self.uploader.on("fileselect", self._fileSelect);
            self.uploader.on("uploadprogress", self._uploadProgress);
            self.uploader.on("uploadcomplete", self.uploadComplete);
            self.uploader.on("uploaderror", self._uploadError);

            self.uploader.render(self.selectFilesButtonContainer);
        });

        $(function () {
            self.resetUploader();
            $(self.confirmUploadSelector).click(self.startUpload);
            $(self.uploadFormSelector).find('.hqm-share-media').change(function () {
                var $sharingOptions = $(self.uploadFormSelector).find('.hqm-sharing');
                ($(this).prop('checked')) ? $sharingOptions.removeClass('hide') : $sharingOptions.addClass('hide');
            });
        });
    };

    self.resetUploader = function () {
        /*
            Start over.
         */
        self.filesInQueueUI = [];
        self.processingIdToFile = {};
        self.allowClose = true;
        self._toggleUploadButton();
        self._resetUploadForm();
        if (!self.isMultiFileUpload) {
            $(self.queueSelector).empty();
        }
    };

    self._clearUploaderData = function () {
        self.uploader.set('fileList', []);
    };

    self._removeFileFromUploader = function (file) {
        var fileList = self.uploader.get('fileList');
        self.uploader.set('fileList', _.without(fileList, file));
        self.filesInQueueUI = _.without(self.filesInQueueUI, file);
    };

    self._fileSelect = function (event) {
        /*
            After files have been selected by the select files function, do this.
         */
        if (!self.isMultiFileUpload) {
            self.resetUploader();
            self.uploader.set('fileList', event.fileList);
        }
        for (var f = 0; f < event.fileList.length; f++) {
            var queuedFile = event.fileList[f];
            if (self.filesInQueueUI.indexOf(queuedFile) < 0) {
                self.filesInQueueUI.push(queuedFile);
                $(self.queueSelector).append(self._processQueueTemplate(queuedFile));
                var activeSelector = self._getActiveUploadSelectors(queuedFile);
                $(activeSelector.cancel).click(self._cancelFileUpload(queuedFile));
                if ($(activeSelector.remove)) {
                    $(activeSelector.remove).click(self._removeFileFromQueue(queuedFile));
                }
            }
        }
        self._toggleUploadButton();
    };

    self.startUpload = function (event) {
        /*
            Begin Upload was clicked.
         */

        // if this has been configured to disallow closing, then disable it
        if (!self.allowCloseDuringUpload) {
            self.allowClose = false;
        }
        if (!self.isMultiFileUpload) {
            var newExtension = '.' + self.filesInQueueUI[0].get('name').split('.').pop().toLowerCase();
            self.uploadParams.path = self.uploadParams.path.replace(/(\.[^/.]+)?$/, newExtension);
        }
        $(self.uploadButtonSelector).addClass('disabled').removeClass('btn-success');
        self._startUploadUI();
        var postParams = _.clone(self.uploadParams);
        for (var key in self.uploadParams) {
            if (self.uploadParams.hasOwnProperty(key)
                && $(self.uploadFormSelector).find('[name="'+key+'"]').prop('checked')) {
                postParams[key] = true;
            }
        }
        // With YUI 3.9 you can trigger downloads on a per file basis, but for now just keep the original behavior
        // of uploading the entire queue.
        self.uploader.uploadAll(self.uploadURL, postParams);
        self._activateQueueUI();
        event.preventDefault();
    };

    self._uploadProgress = function (event) {
        var curUpload = self._getActiveUploadSelectors(event.file);
        $(curUpload.progressBar).attr('style', 'width: ' + event.percentLoaded + '%;');
    };

    self.uploadComplete = function (event) {
        throw new Error("Missing implementation for uploadComplete");
    };

    self._uploadError = function (event) {
        /*
            An error occurred while uploading the file.
         */
        self.allowClose = true;
        self.uploader.queue = null;
        var response = JSON.parse(event.data);
        var errors = [];
        if (response && response.errors) {
            errors = errors.concat(response.errors);
        } else {
            errors.push('Upload Failed: Issue communicating with server.  This usually means your Internet connection is not strong enough. Try again later.')
        }
        var curUpload = self._getActiveUploadSelectors(event.file);
        $(curUpload.progressBarContainer).addClass('progress-danger');
        $(curUpload.progressBar).addClass('progress-bar-danger');
        self._showErrors(event.file, errors);
    };

    self._showErrors = function (file, errors) {
        var curUpload = self._getActiveUploadSelectors(file);
        (errors.length > 0) ? $(curUpload.errorNotice).removeClass('hide') : $(curUpload.errorNotice).addClass('hide');
        $(curUpload.status).append(self._processErrorsTemplate(errors));
    };

}

function HQMediaBulkUploadController (uploader_name, marker, options) {
    'use strict';
    BaseHQMediaUploadController.call(this, uploader_name, marker, options);
    var self = this;
    self.confirmUploadModalSelector = "#hqm-upload-modal";

    // Templates
    self.detailsTemplate = options.detailsTemplate;
    self.statusTemplate = options.statusTemplate;

    self._processDetailsTemplate = function (images, audio, video, unknowns) {
        return _.template(self.detailsTemplate)({
            images: images,
            audio: audio,
            video: video,
            unknowns: unknowns,
        });
    };

    self._processStatusTemplate = function (images, audio, video) {
        var numMatches = images.length + audio.length + video.length;
        return _.template(self.statusTemplate)({
            num: numMatches,
        });
    };


    self._startUploadUI = function () {
        // set the state of the uploader UI here when the upload starts
        if ($(self.confirmUploadModalSelector)) {
            $(self.confirmUploadModalSelector).modal('hide');
        }
    };

    // uploader
    self.uploadComplete = function (event) {
        var curUpload = self._getActiveUploadSelectors(event.file);
        $(curUpload.progressBarContainer).removeClass('active');
        $(curUpload.cancel).addClass('hide');
        self._removeFileFromUploader(event.file);
        var $queuedItem = $(curUpload.selector);
        $queuedItem.remove();
        $queuedItem.insertAfter($(self.processingFilesListSelector).find('.hqm-list-notice'));
        self._beginProcessing(event);
        self._toggleUploadButton();
    };

    // processing flow
    self._beginProcessing = function(event) {
        /*
            The upload completed. Do this...
         */
        var response = JSON.parse(event.data);

        var processing_id = response.processing_id;
        self.processingIdToFile[response.processing_id] = event.file;
        var curUpload = self._getActiveUploadSelectors(event.file);
        $(curUpload.progressBar).addClass('hide').attr('style', 'width: 0%;'); // reset progress bar for processing
        $(curUpload.progressBarContainer).addClass('progress-warning active');
        $(curUpload.progressBar).addClass('progress-bar-warning');
        $(curUpload.processingQueuedNotice).removeClass('hide');
        self._pollProcessingQueue(processing_id)();
    };

    self._pollProcessingQueue = function (processing_id) {
        return function _poll () {
            setTimeout(function () {
                if (processing_id in self.processingIdToFile) {
                    $.ajax({
                        url: self.processingURL,
                        dataType: 'json',
                        data: {
                            processing_id: processing_id,
                        },
                        type: 'POST',
                        success: self._processingProgress,
                        error: self._processingError(processing_id),
                        complete: _poll,
                        timeout: self.pollInterval,
                    });
                }
            }, self.pollInterval);
        };
    };

    self._processingProgress = function (data) {
        self.currentPollAttempts = 0;
        var curUpload = self._getActiveUploadSelectors(self.processingIdToFile[data.processing_id]);
        if (data.in_celery) {
            $(curUpload.processingQueuedNotice).addClass('hide');
            $(curUpload.processingNotice).removeClass('hide');
            $(curUpload.progressBar).removeClass('hide').attr('style', 'width: ' + data.progress + '%;');
            if (data.total_files) {
                var $file_status = $(curUpload.processingNotice).find('.label');
                $file_status.find('.denominator').text(data.total_files);
                $file_status.find('.numerator').text(data.processed_files || 0);
                $file_status.removeClass('hide');
            }
        }
        if (data.complete) {
            self._processingComplete(data);
        }
    };

    self._processingComplete = function (data) {
        var processingFile = self.processingIdToFile[data.processing_id];
        delete self.processingIdToFile[data.processing_id];
        var curUpload = self._getActiveUploadSelectors(processingFile);
        self._stopProcessingFile(processingFile);
        $(curUpload.progressBarContainer).addClass('progress-success');
        $(curUpload.progressBar).addClass('progress-bar-success');

        self._showMatches(processingFile, data);
        self._showErrors(processingFile, data.errors);
    };

    self._processingError = function (processing_id) {
        return function (data, status) {
            if (self.pollInterval < self.maxPollInterval) {
                // first try increasing their timeout, maybe the connection is poor
                self.pollInterval = Math.min(self.pollInterval + 2000, self.maxPollInterval);
            } else {
                self.currentPollAttempts += 1;
            }

            if (self.currentPollAttempts > self.maxPollAttempts) {
                var processingFile = self.processingIdToFile[processing_id];
                delete self.processingIdToFile[processing_id];
                var curUpload = self._getActiveUploadSelectors(processingFile);
                self._stopProcessingFile(processingFile);
                $(curUpload.progressBarContainer).addClass('progress-danger');
                $(curUpload.progressBar).addClass('progress-bar-danger');
                self._showErrors(processingFile, ['There was an issue communicating with the server at this time. ' +
                    'The upload has failed.']);
            }
        };
    };

    self._stopProcessingFile = function (file) {
        var curUpload = self._getActiveUploadSelectors(file);
        if (self.isMultiFileUpload) {
            var $processingItem = $(curUpload.selector);
            $processingItem.remove();
            $processingItem.insertAfter($(self.uploadedFilesListSelector).find('.hqm-list-notice'));
        }

        $(curUpload.processingNotice).addClass('hide');
        $(curUpload.completeNotice).removeClass('hide');
        $(curUpload.progressBar).attr('style', 'width: 100%;');
        $(curUpload.progressBarContainer).removeClass('active progress-warning');
        $(curUpload.progressBar).removeClass('progress-bar-warning');
    };

    self._showMatches = function (file, data) {
        var curUpload = self._getActiveUploadSelectors(file);
        if (data.type === 'zip' && data.matched_files) {
            var images = data.matched_files.CommCareImage,
                audio = data.matched_files.CommCareAudio,
                video = data.matched_files.CommCareVideo,
                unknowns = data.unmatched_files;
            $(curUpload.status).append(self._processStatusTemplate(images, audio, video));

            $(curUpload.details).html(self._processDetailsTemplate(images, audio, video, unknowns));
            $(curUpload.details).find('.match-info').popover({
                html: true,
                title: 'Click to open in new tab.',
                trigger: 'hover',
                placement: 'bottom',
                sanitize: false,
            });
        }
    };

}

HQMediaBulkUploadController.prototype = Object.create( BaseHQMediaUploadController.prototype );
HQMediaBulkUploadController.prototype.constructor = HQMediaBulkUploadController;


function HQMediaFileUploadController (uploader_name, marker, options) {
    'use strict';
    BaseHQMediaUploadController.call(this, uploader_name, marker, options);
    var self = this;
    self.currentReference = null;
    self.existingFileTemplate = options.existingFileTemplate;

    self._processExistingFileTemplate = function (url) {
        return _.template(self.existingFileTemplate)({
            url: url,
        });
    };

    // Essential Selectors
    self.existingFileSelector = self.container + " .hqm-existing";
    self.fileUploadCompleteSelector = self.existingFileSelector + ' .hqm-upload-completed';

    self.updateUploadFormUI = function () {
        var $existingFile = $(self.existingFileSelector);
        $(self.fileUploadCompleteSelector).addClass('hide');

        if (self.currentReference.getUrl() && self.currentReference.isMediaMatched()) {
            $existingFile.removeClass('hide');
            $existingFile.find('.hqm-existing-controls').html(self._processExistingFileTemplate(self.currentReference.getUrl()));
        } else {
            $existingFile.addClass('hide');
            $existingFile.find('.hqm-existing-controls').empty();
        }
        $('.existing-media').tooltip({
            placement: 'bottom',
        });
    };

    self.uploadComplete = function (event) {
        self.allowClose = true;
        var curUpload = self._getActiveUploadSelectors(event.file);
        $(curUpload.cancel).addClass('hide');
        $(curUpload.progressBarContainer).removeClass('active').addClass('progress-success');
        $(curUpload.progressBar).addClass('progress-bar-success');

        var response = JSON.parse(event.data.replace(/\r|\n|\r\n/, '\\n'));
        $('[data-hqmediapath^="' + self.currentReference.path.replace(/\.\w+$/, ".") + '"]').trigger('mediaUploadComplete', response);
        if (!response.errors.length) {
            self.updateUploadFormUI();
            $(self.fileUploadCompleteSelector).removeClass('hide');
            self._removeFileFromUI(event.file);
            self.resetUploader();
        } else {
            self._showErrors(event.file, response.errors);
        }
        self._clearUploaderData();
    };

}

HQMediaFileUploadController.prototype = Object.create( BaseHQMediaUploadController.prototype );
HQMediaFileUploadController.prototype.constructor = HQMediaFileUploadController;
