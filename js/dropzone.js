$("#posterFile").change(function(input){
    var files = input.files ? input.files : input.currentTarget.files;
    if (files) {
        var reader = new FileReader();

        reader.onload = function (e) {
            document.getElementById('poster').style.backgroundImage =  "url('" + e.target.result + "')";
            document.getElementById('posterText').innerHTML = '';
        }

        reader.readAsDataURL(files[0]);
    }
})

// getElementById
function $id(id) {
    return document.getElementById(id);
}

//
// output information
function Output(msg) {
    console.log(msg)
}
// call initialization file
if (window.File && window.FileList && window.FileReader) {
    Init();
}

//
// initialize
function Init() {

    var mediaselect = $id("mediaFiles"),
        extraselect = $id("extraFiles"),
        mediadrag = $id("mediaDrop"),
        extradrag = $id("extraDrop");

    // file select
    mediaselect.addEventListener("change", FileSelectHandler, false);
    extraselect.addEventListener("change", FileSelectHandler, false);

    // is XHR2 available?
    var xhr = new XMLHttpRequest();
    if (xhr.upload) {
    
        // media drop
        mediadrag.addEventListener("dragover", FileDragHover, false);
        mediadrag.addEventListener("dragleave", FileDragHover, false);
        mediadrag.addEventListener("drop", FileSelectHandler, false);
        mediadrag.style.display = "block";

        // extra drop
        extradrag.addEventListener("dragover", FileDragHover, false);
        extradrag.addEventListener("dragleave", FileDragHover, false);
        extradrag.addEventListener("drop", FileSelectHandler, false);
        extradrag.style.display = "block";
        
        // hide file select button
        //fileselect.style.height = 0;
        //fileselect.style.width = 0;
        //$('#mediaFiles').trigger('click');
    }

}

// file selection
function FileSelectHandler(e) {
    console.log(e);

    // cancel event and hover styling
    FileDragHover(e);

    // fetch FileList object
    var files = e.target.files || e.dataTransfer.files;

    // process all File objects
    for (var i = 0, f; f = files[i]; i++) {
        if (e.srcElement.id == "mediaDrop" || e.srcElement.id == "mediaFiles")
            ParseMedia(f);
        else
            ParseExtra(f);
    }

}


// file drag hover
function FileDragHover(e) {
    e.stopPropagation();
    e.preventDefault();
    if (e.target.id == 'mediaDrop')
        e.target.className = (e.type == "dragover" ? "upload-area hover" : "upload-area");
    else if (e.target.id == 'extraDrop')
        e.target.className = (e.type == "dragover" ? "upload-area hover" : "upload-area");
}

function ParseExtra(file) {
    // Show the two tables by default now that we have a file.
    $('#pricing').show();
    $('#extraTable').show();

    console.log(file);
    var tableLength = $('#extraTable tr').length-1;

    $('#extraTable tr:last').after(
        '<tr id="' + file.name.split('.').join('') + '">' +
            '<td>' + tableLength + '</td>' +
            '<td>' + file.name + '</td>' +
            '<td>' +
                '<select class="form-control" id="type">' +
                    '<option>Artwork</option>' +
                    '<option>Zip File</option>' +
                '</select>' +
            '</td>' +
            '<td><input type="text" class="form-control" value="' + file.name + '"></td>' +
       '</tr>');
    AddPricingRow(file);
    
}

function ParseMedia(file) {
    // Show the two tables by default now that we have some media.
    $('#pricing').show();
    $('#mediaFilesTable').show();

    console.log(file);
    var tableLength = $('#mediaFilesTable tr').length-1;

    // Get length if video
    var video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = function() {
        console.log('hi');
        window.URL.revokeObjectURL(this.src)
        duration = video.duration;
        console.log(duration);
        $('#' + file.name + ' td:eq(3)').html(video.duration);
    }
    video.src = URL.createObjectURL(file);
    $('#mediaFilesTable tr:last').after(
        '<tr id="' + file.name.split('.').join('') + '">' +
            '<td>' + tableLength + '</td>' +
            '<td>' + file.name + '</td>' +
            '<td>' + humanFileSize(file.size, true) + '</td>' +
            '<td>...</td>' +
            '<td><input type="text" class="form-control" value="' + file.name + '"></td>' +
            '<td><button type="button" class="btn btn-danger btn-sm" onclick="removeRow(' + file.name.split('.').join('') + ')">x</button></td>' +
        '</tr>');
    AddPricingRow(file);
}

function AddPricingRow(file){
    $('#pricingTable tr:last').after(
    '<tr id="' + file.name.split('.').join('') + 'price">' +
        '<td style="width:20%">' + file.name + '</td>' +
        '<td>' +
            '<div class="input-group">' +
                '<div class="input-group-addon">$</div>' +
                '<input type="text" class="form-control" id="suggestedPlay" onblur="validatePricing()" placeholder="0.000">' +
            '</div>' +
        '</td>' +
        '<td>' +
            '<div class="input-group">' +
                '<div class="input-group-addon">$</div>' +
                '<input type="text" class="form-control" id="minPlay" onblur="validatePricing()" placeholder="0.000">' +
            '</div>' +
       '</td>' +
        '<td>' +
            '<div class="input-group">' +
                '<div class="input-group-addon">$</div>' +
                '<input type="text" class="form-control" id="suggestedBuy" onblur="validatePricing()" placeholder="0.000">' +
            '</div>' +
        '</td>' +
        '<td>' +
            '<div class="input-group">' +
                '<div class="input-group-addon">$</div>' +
                '<input type="text" class="form-control" id="minBuy" onblur="validatePricing()" placeholder="0.000">' +
            '</div>' +
        '</td>' +
        '<td style="width:15%"><input type="checkbox" name="vehicle" value="Bike"> Disallow Play<br><input type="checkbox" name="vehicle" value="Bike"> Disallow Buy</td>' +
    '</tr>');
}
function humanFileSize(bytes, si) {
    var thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    var units = si
        ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
        : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    var u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1)+' '+units[u];
}
function removeRow(name){
    name.remove()
}